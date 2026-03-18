import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Context } from "hono";
import { Pool } from "pg";

import { getConfig } from "../config.js";
import { fetchWithTimeout, HttpError } from "../lib/http.js";
import type { AppLogger } from "../lib/logger.js";
import type {
  Account,
  EarningsResult,
  Keys,
  LatestQuote,
  LatestTrade,
  Position,
  RecordTradeRequest,
  TradeRecord,
  UpdateTradeRequest,
} from "./types.js";

const CREATE_TRADES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS cortana_trades (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  qty NUMERIC,
  notional NUMERIC,
  entry_price NUMERIC,
  target_price NUMERIC,
  stop_loss NUMERIC,
  thesis TEXT,
  signal_source TEXT,
  status TEXT DEFAULT 'open',
  exit_price NUMERIC,
  exit_timestamp TIMESTAMPTZ,
  pnl NUMERIC,
  pnl_pct NUMERIC,
  outcome TEXT,
  metadata JSONB DEFAULT '{}'
);`;

function configuredAlpacaEnvironment(baseURL: string): string {
  if (baseURL.toLowerCase().includes("paper-api.alpaca.markets")) {
    return "paper";
  }
  return "live";
}

function redactKeyID(keyID: string): string {
  const trimmed = keyID.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= 6) {
    return trimmed;
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-2)}`;
}

function keyFingerprint(keyID: string): string {
  const trimmed = keyID.trim();
  if (!trimmed) {
    return "";
  }
  return crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, 12);
}

function normalizeEarningsSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replaceAll("-", ".");
}

function normalizeSide(side: string): string {
  const normalized = side.trim().toLowerCase();
  if (normalized === "buy" || normalized === "sell") {
    return normalized;
  }
  return "";
}

function parseNullableFloat(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : undefined;
}

function toDateOnly(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function daysUntil(dateStr: string | undefined): number | undefined {
  if (!dateStr?.trim()) {
    return undefined;
  }
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  const start = toDateOnly(new Date());
  return Math.floor((parsed.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

function normalizeKeys(keys: Keys): Keys {
  const normalized = { ...keys };
  if (!normalized.base_url) {
    normalized.base_url = "https://paper-api.alpaca.markets";
  }
  normalized.base_url = normalized.base_url.replace(/\/+$/, "");
  if (!normalized.base_url.endsWith("/v2")) {
    normalized.base_url = `${normalized.base_url}/v2`;
  }
  if (!normalized.data_url) {
    normalized.data_url = "https://data.alpaca.markets";
  }
  normalized.data_url = normalized.data_url.replace(/\/+$/, "");
  return normalized;
}

function loadKeysFromEnv(): Keys | null {
  const keyID = (process.env.ALPACA_KEY ?? process.env.ALPACA_KEY_ID ?? "").trim();
  const secret = (process.env.ALPACA_SECRET_KEY ?? "").trim();
  const baseURL = (process.env.ALPACA_ENDPOINT ?? "https://api.alpaca.markets").trim();
  const dataURL = (process.env.ALPACA_DATA_URL ?? "https://data.alpaca.markets").trim();

  if (!keyID || !secret) {
    return null;
  }

  return {
    key_id: keyID,
    secret_key: secret,
    base_url: baseURL,
    data_url: dataURL,
  };
}

function buildOrderPayload(input: RecordTradeRequest, symbol: string, side: string): Record<string, unknown> {
  const orderType = (input.order_type ?? "market").trim().toLowerCase();
  const tif = (input.time_in_force ?? "day").trim().toLowerCase();

  if (orderType === "limit" && input.limit_price == null) {
    throw new Error("limit_price is required for limit orders");
  }
  if (orderType === "stop" && input.stop_price == null) {
    throw new Error("stop_price is required for stop orders");
  }
  if (orderType === "stop_limit" && (input.limit_price == null || input.stop_price == null)) {
    throw new Error("limit_price and stop_price are required for stop_limit orders");
  }
  if (input.extended_hours) {
    if (orderType !== "limit") {
      throw new Error("extended_hours is only supported for limit orders");
    }
    if (tif !== "day") {
      throw new Error("extended_hours requires time_in_force to be day");
    }
  }

  const payload: Record<string, unknown> = {
    symbol,
    side,
    type: orderType,
    time_in_force: tif,
  };
  if (input.qty != null) {
    payload.qty = input.qty;
  }
  if (input.notional != null) {
    payload.notional = input.notional;
  }
  if (input.limit_price != null) {
    payload.limit_price = input.limit_price.toFixed(2);
  }
  if (input.stop_price != null) {
    payload.stop_price = input.stop_price.toFixed(2);
  }
  if (input.extended_hours) {
    payload.extended_hours = true;
  }

  return payload;
}

export class AlpacaService {
  private readonly config = getConfig();
  private keys: Keys | null = null;
  private keysPath = "";
  private pool: Pool | null = null;
  private dbReadyPromise: Promise<void> | null = null;

  constructor(private readonly logger: AppLogger, private readonly fetchImpl: typeof fetch = fetch) {}

  private resolvedKeysPath(): string {
    if (process.env.ALPACA_KEYS_PATH?.trim()) {
      return process.env.ALPACA_KEYS_PATH.trim();
    }
    if (this.config.ALPACA_KEYS_PATH.trim()) {
      return this.config.ALPACA_KEYS_PATH.trim();
    }
    if (this.keysPath.trim()) {
      return this.keysPath.trim();
    }
    return path.join(os.homedir(), "Desktop", "services", "alpaca_keys.json");
  }

  private validateKeys(keys: Keys, keySource: string): void {
    const target = (process.env.ALPACA_TARGET_ENVIRONMENT ?? this.config.ALPACA_TARGET_ENVIRONMENT ?? "").trim().toLowerCase();
    if (!target) {
      return;
    }
    const actual = configuredAlpacaEnvironment(keys.base_url);
    if (target !== actual) {
      throw new Error(`alpaca account target mismatch: target=${target} actual=${actual} keys_path=${keySource}`);
    }
  }

  private async loadKeys(): Promise<void> {
    const envKeys = loadKeysFromEnv();
    if (envKeys) {
      const normalized = normalizeKeys(envKeys);
      this.validateKeys(normalized, "env:ALPACA_KEY/ALPACA_SECRET_KEY");
      this.keys = normalized;
      this.keysPath = "env:ALPACA_KEY/ALPACA_SECRET_KEY";
      return;
    }

    const keyPath = this.resolvedKeysPath();
    const raw = await fs.promises.readFile(keyPath, "utf-8");
    const parsed = JSON.parse(raw) as Keys;
    const normalized = normalizeKeys(parsed);
    this.validateKeys(normalized, keyPath);

    this.keys = normalized;
    this.keysPath = keyPath;
  }

  private async ensureKeysLoaded(): Promise<void> {
    if (!this.keys) {
      await this.loadKeys();
      return;
    }
    this.validateKeys(this.keys, this.resolvedKeysPath());
  }

  private async ensureDB(): Promise<void> {
    if (this.dbReadyPromise) {
      return this.dbReadyPromise;
    }

    this.dbReadyPromise = (async () => {
      const pool = new Pool({
        connectionString: process.env.CORTANA_DATABASE_URL ?? this.config.CORTANA_DATABASE_URL,
        max: 5,
        idleTimeoutMillis: 30 * 60 * 1000,
      });

      const client = await pool.connect();
      try {
        await client.query("SELECT 1");
        await client.query(CREATE_TRADES_TABLE_SQL);
      } finally {
        client.release();
      }
      this.pool = pool;
    })();

    return this.dbReadyPromise;
  }

  private async makeJSONRequest(
    method: string,
    endpoint: string,
    payload: unknown,
    acceptedStatuses: number[] = [200],
    timeoutMs = 30_000,
  ): Promise<string> {
    await this.ensureKeysLoaded();
    const keys = this.keys;
    if (!keys) {
      throw new Error("alpaca keys are not loaded");
    }

    const response = await fetchWithTimeout(
      endpoint,
      {
        method,
        body: payload == null ? undefined : JSON.stringify(payload),
        headers: {
          "APCA-API-KEY-ID": keys.key_id,
          "APCA-API-SECRET-KEY": keys.secret_key,
          "Content-Type": "application/json",
        },
      },
      timeoutMs,
    );

    const text = await response.text();
    if (!acceptedStatuses.includes(response.status)) {
      throw new Error(`alpaca API error ${response.status}: ${text}`);
    }
    return text;
  }

  private async fetchYahooEarnings(symbol: string): Promise<{ date: string; confirmed: boolean } | null> {
    const normalized = normalizeEarningsSymbol(symbol);
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${normalized}?modules=calendarEvents`;
    const response = await this.fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`yahoo ${response.status}: ${body.slice(0, 512)}`);
    }

    const payload = (await response.json()) as {
      quoteSummary?: {
        result?: Array<{
          calendarEvents?: {
            earnings?: {
              earningsDate?: Array<{ fmt?: string }>;
            };
          };
        }>;
      };
    };

    const date = payload.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate?.[0]?.fmt?.trim();
    if (!date) {
      return null;
    }
    return { date, confirmed: false };
  }

  private async fetchAlpacaEarningsNewsSignal(symbol: string): Promise<boolean> {
    await this.ensureKeysLoaded();
    const keys = this.keys;
    if (!keys) {
      return false;
    }

    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const endpoint = `${keys.data_url}/v1beta1/news?symbols=${symbol.toUpperCase()}&start=${from}&end=${to}&limit=50`;

    const raw = await this.makeJSONRequest("GET", endpoint, null, [200]);
    const payload = JSON.parse(raw) as { news?: Array<{ headline?: string; summary?: string }> };
    return Boolean(
      payload.news?.some((entry) => {
        const text = `${entry.headline ?? ""} ${entry.summary ?? ""}`.toLowerCase();
        return text.includes("earnings") || text.includes("quarterly results");
      }),
    );
  }

  private async fetchLatestTradePrice(symbol: string): Promise<number | undefined> {
    const keys = this.keys;
    if (!keys) {
      return undefined;
    }
    try {
      const raw = await this.makeJSONRequest("GET", `${keys.data_url}/v2/stocks/${symbol}/trades/latest`, null);
      const payload = JSON.parse(raw) as { trade?: LatestTrade };
      if (!payload.trade || payload.trade.p <= 0) {
        return undefined;
      }
      return payload.trade.p;
    } catch {
      return undefined;
    }
  }

  async checkHealth(): Promise<Record<string, unknown>> {
    await this.loadKeys();
    const keys = this.keys;
    if (!keys) {
      throw new Error("keys not available");
    }
    await this.makeJSONRequest("GET", `${keys.base_url}/account`, null);

    return {
      status: "healthy",
      environment: configuredAlpacaEnvironment(keys.base_url),
      keys_path: this.resolvedKeysPath(),
      key_id_redacted: redactKeyID(keys.key_id),
      key_fingerprint: keyFingerprint(keys.key_id),
      target_environment: (process.env.ALPACA_TARGET_ENVIRONMENT ?? this.config.ALPACA_TARGET_ENVIRONMENT ?? "").trim().toLowerCase(),
    };
  }

  async healthHandler(c: Context): Promise<Response> {
    try {
      const payload = await this.checkHealth();
      return c.json(payload);
    } catch (error) {
      return c.json({ status: "unhealthy", error: error instanceof Error ? error.message : String(error) }, 503);
    }
  }

  async accountHandler(c: Context): Promise<Response> {
    try {
      await this.ensureKeysLoaded();
      const keys = this.keys!;
      const data = await this.makeJSONRequest("GET", `${keys.base_url}/account`, null);
      return c.json(JSON.parse(data) as Account);
    } catch (error) {
      this.logger.error("alpaca account request failed", error);
      const status = error instanceof Error && error.message.includes("failed to read keys") ? 503 : 502;
      return c.json({ error: error instanceof Error ? error.message : String(error) }, status);
    }
  }

  async positionsHandler(c: Context): Promise<Response> {
    try {
      await this.ensureKeysLoaded();
      const keys = this.keys!;
      const data = await this.makeJSONRequest("GET", `${keys.base_url}/positions`, null);
      return c.json(JSON.parse(data) as Position[]);
    } catch (error) {
      const status = error instanceof Error && error.message.includes("failed to read keys") ? 503 : 502;
      return c.json({ error: error instanceof Error ? error.message : String(error) }, status);
    }
  }

  async portfolioHandler(c: Context): Promise<Response> {
    try {
      await this.ensureKeysLoaded();
      const keys = this.keys!;

      const [accountData, positionsData] = await Promise.all([
        this.makeJSONRequest("GET", `${keys.base_url}/account`, null, [200], 8_000),
        this.makeJSONRequest("GET", `${keys.base_url}/positions`, null),
      ]);

      return c.json({
        account: JSON.parse(accountData) as Account,
        positions: JSON.parse(positionsData) as Position[],
        timestamp: new Date().toISOString(),
        environment: configuredAlpacaEnvironment(keys.base_url),
        keys_path: this.resolvedKeysPath(),
        key_id_redacted: redactKeyID(keys.key_id),
        key_fingerprint: keyFingerprint(keys.key_id),
        target_environment: (process.env.ALPACA_TARGET_ENVIRONMENT ?? this.config.ALPACA_TARGET_ENVIRONMENT ?? "").trim().toLowerCase(),
      });
    } catch (error) {
      const status = error instanceof Error && error.message.includes("failed to read keys") ? 503 : 502;
      return c.json({ error: error instanceof Error ? error.message : String(error) }, status);
    }
  }

  async earningsHandler(c: Context): Promise<Response> {
    try {
      await this.ensureKeysLoaded();
      const keys = this.keys!;
      const symbolQuery = c.req.query("symbols")?.trim() ?? "";
      let symbols = symbolQuery
        ? symbolQuery
            .split(",")
            .map((value) => value.trim().toUpperCase())
            .filter(Boolean)
        : [];

      if (!symbols.length) {
        const positionsData = await this.makeJSONRequest("GET", `${keys.base_url}/positions`, null);
        const positions = JSON.parse(positionsData) as Position[];
        symbols = positions.map((entry) => entry.symbol.trim().toUpperCase()).filter(Boolean);
      }

      const deduped = Array.from(new Set(symbols));
      const results: EarningsResult[] = [];

      for (const symbol of deduped) {
        let yahooDate: string | undefined;
        let yahooConfirmed = false;
        let yahooError: unknown = null;
        let newsSignal = false;
        let newsError: unknown = null;

        try {
          const yahoo = await this.fetchYahooEarnings(symbol);
          yahooDate = yahoo?.date;
          yahooConfirmed = yahoo?.confirmed ?? false;
        } catch (error) {
          yahooError = error;
        }
        try {
          newsSignal = await this.fetchAlpacaEarningsNewsSignal(symbol);
        } catch (error) {
          newsError = error;
        }

        const item: EarningsResult = {
          symbol,
          earnings_date: yahooDate,
          confirmed: yahooConfirmed,
          source: "yahoo",
          days_until: daysUntil(yahooDate),
        };

        if (newsSignal) {
          item.note = "alpaca_news_contains_earnings";
        }

        if (yahooError) {
          item.source = "alpaca_news_only";
          delete item.earnings_date;
          delete item.days_until;
          if (newsError) {
            item.note = "yahoo_and_alpaca_news_unavailable";
          }
        }

        results.push(item);
      }

      return c.json({
        results,
        timestamp: new Date().toISOString(),
        strategy: "alpaca-news + yahoo-calendar-fallback",
      });
    } catch (error) {
      const status = error instanceof Error && error.message.includes("failed to read keys") ? 503 : 502;
      return c.json({ error: error instanceof Error ? error.message : String(error) }, status);
    }
  }

  async quoteHandler(c: Context): Promise<Response> {
    try {
      await this.ensureKeysLoaded();
      const keys = this.keys!;
      const symbol = c.req.param("symbol")?.trim().toUpperCase() ?? "";
      if (!symbol) {
        return c.json({ error: "symbol is required" }, 400);
      }

      const quoteData = await this.makeJSONRequest("GET", `${keys.data_url}/v2/stocks/${symbol}/quotes/latest`, null);
      const tradeData = await this.makeJSONRequest("GET", `${keys.data_url}/v2/stocks/${symbol}/trades/latest`, null);

      const quotePayload = JSON.parse(quoteData) as { quote?: LatestQuote };
      const tradePayload = JSON.parse(tradeData) as { trade?: LatestTrade };

      return c.json({
        symbol,
        bid: quotePayload.quote?.bp,
        ask: quotePayload.quote?.ap,
        last_price: tradePayload.trade?.p,
        timestamp: quotePayload.quote?.t || tradePayload.trade?.t || "",
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  }

  async snapshotHandler(c: Context): Promise<Response> {
    try {
      await this.ensureKeysLoaded();
      const keys = this.keys!;
      const symbol = c.req.param("symbol")?.trim().toUpperCase() ?? "";
      if (!symbol) {
        return c.json({ error: "symbol is required" }, 400);
      }

      const data = await this.makeJSONRequest("GET", `${keys.data_url}/v2/stocks/${symbol}/snapshot`, null);
      const payload = JSON.parse(data) as Record<string, unknown>;

      return c.json({
        symbol,
        latest_trade: payload.latestTrade,
        latest_quote: payload.latestQuote,
        minute_bar: payload.minuteBar,
        daily_bar: payload.dailyBar,
        prev_daily_bar: payload.prevDailyBar,
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  }

  async barsHandler(c: Context): Promise<Response> {
    try {
      await this.ensureKeysLoaded();
      const keys = this.keys!;
      const symbol = c.req.param("symbol")?.trim().toUpperCase() ?? "";
      if (!symbol) {
        return c.json({ error: "symbol is required" }, 400);
      }

      const data = await this.makeJSONRequest("GET", `${keys.data_url}/v2/stocks/${symbol}/bars?timeframe=1Day&limit=5`, null);
      const payload = JSON.parse(data) as { bars?: Array<Record<string, unknown>> };

      return c.json({
        symbol,
        bars: payload.bars ?? [],
        count: (payload.bars ?? []).length,
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  }

  async tradesHandler(c: Context): Promise<Response> {
    try {
      await this.ensureDB();
      const pool = this.pool!;
      const result = await pool.query<{
        id: number;
        timestamp: Date;
        symbol: string;
        side: string;
        qty: number | null;
        notional: number | null;
        entry_price: number | null;
        target_price: number | null;
        stop_loss: number | null;
        thesis: string | null;
        signal_source: string | null;
        status: string | null;
        exit_price: number | null;
        exit_timestamp: Date | null;
        pnl: number | null;
        pnl_pct: number | null;
        outcome: string | null;
        metadata: unknown;
      }>(`
        SELECT id, timestamp, symbol, side, qty::float8, notional::float8, entry_price::float8,
               target_price::float8, stop_loss::float8, thesis, signal_source, status,
               exit_price::float8, exit_timestamp, pnl::float8, pnl_pct::float8, outcome, metadata
        FROM cortana_trades
        ORDER BY timestamp DESC
        LIMIT 200
      `);

      const trades: TradeRecord[] = result.rows.map((row) => ({
        id: row.id,
        timestamp: row.timestamp?.toISOString(),
        symbol: row.symbol,
        side: row.side,
        qty: row.qty,
        notional: row.notional,
        entry_price: row.entry_price,
        target_price: row.target_price,
        stop_loss: row.stop_loss,
        thesis: row.thesis ?? "",
        signal_source: row.signal_source ?? "",
        status: row.status ?? "",
        exit_price: row.exit_price,
        exit_timestamp: row.exit_timestamp?.toISOString() ?? null,
        pnl: row.pnl,
        pnl_pct: row.pnl_pct,
        outcome: row.outcome ?? "",
        metadata: row.metadata,
      }));

      return c.json({ trades });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  async recordTradeHandler(c: Context): Promise<Response> {
    try {
      const request = (await c.req.json()) as RecordTradeRequest;
      await this.ensureKeysLoaded();

      const symbol = (request.symbol ?? "").trim().toUpperCase();
      const side = normalizeSide(request.side ?? "");
      if (!symbol || !side) {
        return c.json({ error: "symbol and side (buy/sell) are required" }, 400);
      }
      if (request.qty == null && request.notional == null) {
        return c.json({ error: "qty or notional is required" }, 400);
      }
      if (request.qty != null && request.notional != null) {
        return c.json({ error: "provide qty or notional, not both" }, 400);
      }
      if (request.qty != null && request.qty <= 0) {
        return c.json({ error: "qty must be > 0" }, 400);
      }
      if (request.notional != null && request.notional <= 0) {
        return c.json({ error: "notional must be > 0" }, 400);
      }

      const orderPayload = buildOrderPayload(request, symbol, side);
      await this.ensureDB();
      const keys = this.keys!;

      const rawOrder = await this.makeJSONRequest("POST", `${keys.base_url}/orders`, orderPayload, [200, 201]);
      const alpacaOrder = JSON.parse(rawOrder) as Record<string, unknown>;
      let entryPrice = parseNullableFloat(alpacaOrder.filled_avg_price);
      if (entryPrice == null) {
        entryPrice = await this.fetchLatestTradePrice(symbol);
      }

      const metadata = { alpaca_order: alpacaOrder };
      const insert = await this.pool!.query<{ id: number; timestamp: Date }>(
        `
          INSERT INTO cortana_trades (
            symbol, side, qty, notional, entry_price, target_price, stop_loss,
            thesis, signal_source, status, metadata
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          RETURNING id, timestamp
        `,
        [
          symbol,
          side,
          request.qty ?? null,
          request.notional ?? null,
          entryPrice ?? null,
          request.target_price ?? null,
          request.stop_loss ?? null,
          (request.thesis ?? "").trim(),
          (request.signal_source ?? "").trim(),
          "open",
          metadata,
        ],
      );

      const row = insert.rows[0];
      const trade: TradeRecord = {
        id: row.id,
        timestamp: row.timestamp.toISOString(),
        symbol,
        side,
        qty: request.qty ?? null,
        notional: request.notional ?? null,
        entry_price: entryPrice ?? null,
        target_price: request.target_price ?? null,
        stop_loss: request.stop_loss ?? null,
        thesis: (request.thesis ?? "").trim(),
        signal_source: (request.signal_source ?? "").trim(),
        status: "open",
        metadata,
      };

      return c.json({ trade, alpaca_order: alpacaOrder }, 201);
    } catch (error) {
      const message = error instanceof HttpError ? `alpaca API error ${error.status}: ${error.body}` : error instanceof Error ? error.message : String(error);
      const status = message.includes("failed to read keys") ? 503 : message.startsWith("alpaca API error") ? 502 : 500;
      return c.json({ error: message }, status);
    }
  }

  async updateTradeHandler(c: Context): Promise<Response> {
    try {
      await this.ensureDB();
      const idRaw = c.req.param("id")?.trim() ?? "";
      if (!idRaw) {
        return c.json({ error: "trade id is required" }, 400);
      }
      const id = Number.parseInt(idRaw, 10);
      if (!Number.isInteger(id)) {
        return c.json({ error: "trade id must be an integer" }, 400);
      }

      const request = (await c.req.json()) as UpdateTradeRequest;
      const current = await this.pool!.query<{ entry_price: number | null; qty: number | null }>(
        "SELECT entry_price::float8, qty::float8 FROM cortana_trades WHERE id = $1",
        [id],
      );
      if (!current.rowCount) {
        return c.json({ error: "trade not found" }, 404);
      }

      const setParts: string[] = [];
      const args: unknown[] = [];
      let arg = 1;

      if (request.status != null) {
        setParts.push(`status = $${arg++}`);
        args.push(request.status.trim());
      }
      if (request.outcome != null) {
        setParts.push(`outcome = $${arg++}`);
        args.push(request.outcome.trim());
      }
      if (request.exit_price != null) {
        setParts.push(`exit_price = $${arg++}`);
        args.push(request.exit_price);
        setParts.push("exit_timestamp = NOW()");

        const entry = current.rows[0].entry_price;
        const qty = current.rows[0].qty;
        if (entry != null) {
          let pnl = request.exit_price - entry;
          if (qty != null) {
            pnl *= qty;
          }
          setParts.push(`pnl = $${arg++}`);
          args.push(pnl);

          if (entry !== 0) {
            const pct = ((request.exit_price / entry) - 1) * 100;
            if (Number.isFinite(pct)) {
              setParts.push(`pnl_pct = $${arg++}`);
              args.push(pct);
            }
          }
        }
      }

      if (!setParts.length) {
        return c.json({ error: "no update fields provided" }, 400);
      }

      args.push(id);
      const result = await this.pool!.query(`UPDATE cortana_trades SET ${setParts.join(", ")} WHERE id = $${arg}`, args);
      if (!result.rowCount) {
        return c.json({ error: "trade not found" }, 404);
      }

      return c.json({ status: "updated", trade_id: id });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  async statsHandler(c: Context): Promise<Response> {
    try {
      await this.ensureDB();
      const result = await this.pool!.query<{
        total: number;
        open: number;
        closed: number;
        wins: number;
        total_pnl: number | null;
      }>(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'open')::int AS open,
          COUNT(*) FILTER (WHERE status = 'closed')::int AS closed,
          COUNT(*) FILTER (WHERE status = 'closed' AND COALESCE(pnl,0) > 0)::int AS wins,
          SUM(pnl)::float8 AS total_pnl
        FROM cortana_trades
      `);
      const row = result.rows[0];
      const winRate = row.closed > 0 ? (row.wins / row.closed) * 100 : 0;

      return c.json({
        total_trades: row.total,
        open: row.open,
        closed: row.closed,
        wins: row.wins,
        win_rate: winRate,
        total_pnl: row.total_pnl ?? 0,
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  async performanceHandler(c: Context): Promise<Response> {
    try {
      await this.ensureDB();
      await this.ensureKeysLoaded();
      const keys = this.keys!;

      const summaryRow = (
        await this.pool!.query<{
          total_trades: number;
          avg_return: number | null;
          wins: number;
        }>(`
          SELECT
            COUNT(*)::int AS total_trades,
            AVG(pnl_pct)::float8 AS avg_return,
            COUNT(*) FILTER (WHERE status = 'closed' AND COALESCE(pnl,0) > 0)::int AS wins
          FROM cortana_trades
        `)
      ).rows[0];

      const closedCountRow = (await this.pool!.query<{ closed_count: number }>(
        "SELECT COUNT(*)::int AS closed_count FROM cortana_trades WHERE status = 'closed'",
      )).rows[0];
      const winRate = closedCountRow.closed_count > 0 ? (summaryRow.wins / closedCountRow.closed_count) * 100 : 0;

      const bestTrade = (
        await this.pool!.query<{ symbol: string | null; pnl_pct: number | null }>(
          "SELECT symbol, pnl_pct::float8 FROM cortana_trades WHERE pnl_pct IS NOT NULL ORDER BY pnl_pct DESC LIMIT 1",
        )
      ).rows[0] ?? { symbol: "", pnl_pct: 0 };
      const worstTrade = (
        await this.pool!.query<{ symbol: string | null; pnl_pct: number | null }>(
          "SELECT symbol, pnl_pct::float8 FROM cortana_trades WHERE pnl_pct IS NOT NULL ORDER BY pnl_pct ASC LIMIT 1",
        )
      ).rows[0] ?? { symbol: "", pnl_pct: 0 };

      const signals = await this.pool!.query<{
        signal_source: string;
        trade_count: number;
        avg_return: number | null;
        source_wins: number;
        source_closed: number;
      }>(`
        SELECT COALESCE(NULLIF(signal_source, ''), 'unknown') as signal_source,
               COUNT(*)::int AS trade_count,
               AVG(pnl_pct)::float8 AS avg_return,
               COUNT(*) FILTER (WHERE status='closed' AND COALESCE(pnl,0) > 0)::int AS source_wins,
               COUNT(*) FILTER (WHERE status='closed')::int AS source_closed
        FROM cortana_trades
        GROUP BY 1
        ORDER BY 2 DESC
      `);

      const positionsData = await this.makeJSONRequest("GET", `${keys.base_url}/positions`, null);
      const positions = JSON.parse(positionsData) as Position[];

      return c.json({
        summary: {
          total_trades: summaryRow.total_trades,
          closed_trades: closedCountRow.closed_count,
          win_rate: winRate,
          avg_return_pct: summaryRow.avg_return ?? 0,
          best_trade: { symbol: bestTrade.symbol ?? "", return_pct: bestTrade.pnl_pct ?? 0 },
          worst_trade: { symbol: worstTrade.symbol ?? "", return_pct: worstTrade.pnl_pct ?? 0 },
        },
        by_signal_source: signals.rows.map((row) => ({
          signal_source: row.signal_source,
          trade_count: row.trade_count,
          avg_return_pct: row.avg_return ?? 0,
          win_rate: row.source_closed > 0 ? (row.source_wins / row.source_closed) * 100 : 0,
        })),
        open_positions: positions.map((position) => ({
          symbol: position.symbol,
          qty: position.qty,
          avg_entry_price: position.avg_entry_price,
          current_price: position.current_price,
          market_value: position.market_value,
          unrealized_pnl: position.unrealized_pl,
          unrealized_pnl_pct: position.unrealized_plpc,
          change_today: position.change_today,
        })),
        open_positions_count: positions.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("failed to read keys") ? 503 : message.startsWith("alpaca API error") ? 502 : 500;
      return c.json({ error: message }, status);
    }
  }
}

export interface CreateAlpacaServiceConfig {
  logger: AppLogger;
  fetchImpl?: typeof fetch;
}

export function createAlpacaService(config: CreateAlpacaServiceConfig): AlpacaService {
  return new AlpacaService(config.logger, config.fetchImpl);
}

export { buildOrderPayload, normalizeSide };
