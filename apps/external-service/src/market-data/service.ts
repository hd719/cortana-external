import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AppConfig } from "../config.js";
import { HttpError, readJsonResponse } from "../lib/http.js";
import type { AppLogger } from "../lib/logger.js";
import { createLogger } from "../lib/logger.js";
import type {
  MarketDataComparison,
  MarketDataGenericPayload,
  MarketDataHistory,
  MarketDataHistoryPoint,
  MarketDataQuote,
  MarketDataResponse,
  MarketDataRiskHistory,
  MarketDataRiskHistoryPoint,
  MarketDataRiskSnapshot,
  MarketDataRouteResult,
  MarketDataSnapshot,
  MarketDataStatus,
  MarketDataUniverse,
} from "./types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DEFAULT_INTERVAL = "1d";
const YAHOO_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const CBOE_ENDPOINTS = [
  "https://cdn.cboe.com/api/global/us_indices/market_statistics/put_call_ratio.csv",
  "https://cdn.cboe.com/api/global/us_indices/market_statistics/daily_options_data.csv",
  "https://cdn.cboe.com/api/global/us_indices/market_statistics/put_call_ratio/daily.csv",
  "https://cdn.cboe.com/api/global/us_indices/market_statistics/put_call_ratio.json",
];

type FetchImpl = typeof fetch;

interface MarketDataServiceConfig {
  config?: AppConfig;
  logger?: AppLogger;
  fetchImpl?: FetchImpl;
}

interface ServiceMetadata {
  source: string;
  status: MarketDataStatus;
  degradedReason?: string | null;
  stalenessSeconds: number | null;
}

interface HistoryFetchResult extends ServiceMetadata {
  rows: MarketDataHistoryPoint[];
}

interface QuoteFetchResult extends ServiceMetadata {
  quote: MarketDataQuote;
}

interface SnapshotFetchResult extends ServiceMetadata {
  snapshot: MarketDataSnapshot;
}

interface JsonRecord {
  [key: string]: unknown;
}

interface CachedTokenPayload {
  accessToken: string;
  expiresAt: number;
}

interface AlpacaKeys {
  key_id: string;
  secret_key: string;
  data_url: string;
}

interface RiskRow {
  date: string;
  vix: number;
  spy_close: number;
  hy_spread: number;
  put_call: number;
  vix_percentile: number;
  hy_spread_percentile: number;
  spy_distance_score: number;
  fear_greed: number;
}

export class MarketDataService {
  private readonly logger: AppLogger;
  private readonly fetchImpl: FetchImpl;
  private readonly config: AppConfig;
  private readonly requestTimeoutMs: number;
  private readonly cacheDir: string;
  private readonly universeSeedPath: string;
  private readonly schwabTokenPath: string;

  constructor(config: MarketDataServiceConfig = {}) {
    this.logger = config.logger ?? createLogger("market-data");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.config = config.config ?? ({
      PORT: 3033,
      MARKET_DATA_CACHE_DIR: ".cache/market_data",
      MARKET_DATA_REQUEST_TIMEOUT_MS: 30_000,
      MARKET_DATA_UNIVERSE_SEED_PATH: "backtester/data/universe.py",
      SCHWAB_CLIENT_ID: "",
      SCHWAB_CLIENT_SECRET: "",
      SCHWAB_REFRESH_TOKEN: "",
      SCHWAB_TOKEN_PATH: ".cache/market_data/schwab-token.json",
      SCHWAB_API_BASE_URL: "https://api.schwabapi.com",
      SCHWAB_TOKEN_URL: "https://api.schwabapi.com/v1/oauth/token",
      FRED_API_KEY: "",
      WHOOP_CLIENT_ID: "",
      WHOOP_CLIENT_SECRET: "",
      WHOOP_REDIRECT_URL: "http://localhost:3033/auth/callback",
      WHOOP_TOKEN_PATH: "whoop_tokens.json",
      WHOOP_DATA_PATH: "whoop_data.json",
      TONAL_EMAIL: "",
      TONAL_PASSWORD: "",
      TONAL_TOKEN_PATH: "tonal_tokens.json",
      TONAL_DATA_PATH: "tonal_data.json",
      ALPACA_KEYS_PATH: "",
      ALPACA_TARGET_ENVIRONMENT: "live",
      CORTANA_DATABASE_URL: "postgres://localhost:5432/cortana?sslmode=disable",
    } satisfies AppConfig);
    this.requestTimeoutMs = this.config.MARKET_DATA_REQUEST_TIMEOUT_MS;
    this.cacheDir = resolveRepoPath(this.config.MARKET_DATA_CACHE_DIR);
    this.universeSeedPath = resolveRepoPath(this.config.MARKET_DATA_UNIVERSE_SEED_PATH);
    this.schwabTokenPath = resolveRepoPath(this.config.SCHWAB_TOKEN_PATH);
  }

  async checkHealth(): Promise<Record<string, unknown>> {
    return {
      status: "healthy",
      providers: {
        schwab: this.isSchwabConfigured() ? "configured" : "disabled",
        yahoo: "ready",
        fred: this.config.FRED_API_KEY ? "configured" : "unauthenticated",
        universeSeedPath: this.universeSeedPath,
      },
    };
  }

  async handleHistory(request: Request, rawSymbol: string, compareWith?: string): Promise<MarketDataRouteResult<MarketDataHistory>> {
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }

    const period = resolveQuery(request.url, "period", "1y");
    const interval = resolveQuery(request.url, "interval", DEFAULT_INTERVAL);
    try {
      const primary = await this.fetchPrimaryHistory(symbol, period, interval);
      const compare = await this.buildHistoryComparison(symbol, period, interval, compareWith, primary.rows);
      return {
        status: 200,
        body: {
          source: primary.source,
          status: primary.status,
          degradedReason: primary.degradedReason ?? null,
          stalenessSeconds: primary.stalenessSeconds,
          data: { symbol, period, interval, rows: primary.rows, comparisonHint: compare?.source },
          ...(compare ? { compare_with: compare } : {}),
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataHistory>(error, {
        symbol,
        period,
        interval,
        rows: [],
      });
    }
  }

  async handleQuote(_request: Request, rawSymbol: string, compareWith?: string): Promise<MarketDataRouteResult<MarketDataQuote>> {
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }

    try {
      const primary = await this.fetchPrimaryQuote(symbol);
      const compare = await this.buildQuoteComparison(symbol, compareWith, primary.quote);
      return {
        status: 200,
        body: {
          source: primary.source,
          status: primary.status,
          degradedReason: primary.degradedReason ?? null,
          stalenessSeconds: primary.stalenessSeconds,
          data: primary.quote,
          ...(compare ? { compare_with: compare } : {}),
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataQuote>(error, { symbol });
    }
  }

  async handleSnapshot(
    _request: Request,
    rawSymbol: string,
    compareWith?: string,
  ): Promise<MarketDataRouteResult<MarketDataSnapshot>> {
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }

    try {
      const primary = await this.fetchPrimarySnapshot(symbol);
      const compare = await this.buildQuoteComparison(symbol, compareWith, primary.snapshot.quote as MarketDataQuote | undefined);
      return {
        status: 200,
        body: {
          source: primary.source,
          status: primary.status,
          degradedReason: primary.degradedReason ?? null,
          stalenessSeconds: primary.stalenessSeconds,
          data: primary.snapshot,
          ...(compare ? { compare_with: compare } : {}),
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataSnapshot>(error, { symbol, quote: {}, fundamentals: {}, metadata: {} });
    }
  }

  async handleFundamentals(
    request: Request,
    rawSymbol: string,
    compareWith?: string,
  ): Promise<MarketDataRouteResult<MarketDataGenericPayload>> {
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }

    try {
      const asOfDate = resolveQuery(request.url, "as_of_date", "");
      const payload = await this.fetchYahooFundamentals(symbol, asOfDate || undefined);
      const compare = compareWith ? buildUnavailableCompare(compareWith, "comparison is only implemented for history/quote paths") : undefined;
      return {
        status: 200,
        body: {
          source: "yahoo",
          status: "ok",
          degradedReason: null,
          stalenessSeconds: 0,
          data: { symbol, payload },
          ...(compare ? { compare_with: compare } : {}),
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataGenericPayload>(error, { symbol, payload: {} });
    }
  }

  async handleMetadata(
    _request: Request,
    rawSymbol: string,
    compareWith?: string,
  ): Promise<MarketDataRouteResult<MarketDataGenericPayload>> {
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }

    try {
      const payload = await this.fetchYahooMetadata(symbol);
      const compare = compareWith ? buildUnavailableCompare(compareWith, "comparison is only implemented for history/quote paths") : undefined;
      return {
        status: 200,
        body: {
          source: "yahoo",
          status: "ok",
          degradedReason: null,
          stalenessSeconds: 0,
          data: { symbol, payload },
          ...(compare ? { compare_with: compare } : {}),
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataGenericPayload>(error, { symbol, payload: {} });
    }
  }

  async handleNews(
    _request: Request,
    rawSymbol: string,
    compareWith?: string,
  ): Promise<MarketDataRouteResult<MarketDataGenericPayload>> {
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }

    try {
      const payload = await this.fetchYahooNews(symbol);
      const compare = compareWith ? buildUnavailableCompare(compareWith, "comparison is only implemented for history/quote paths") : undefined;
      return {
        status: 200,
        body: {
          source: "yahoo",
          status: "ok",
          degradedReason: null,
          stalenessSeconds: 0,
          data: { symbol, payload },
          ...(compare ? { compare_with: compare } : {}),
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataGenericPayload>(error, { symbol, payload: { items: [] } });
    }
  }

  async handleUniverseBase(): Promise<MarketDataRouteResult<MarketDataUniverse>> {
    try {
      const payload = await this.loadOrRefreshUniverseArtifact(false);
      return {
        status: 200,
        body: {
          source: payload.source,
          status: "ok",
          degradedReason: null,
          stalenessSeconds: this.secondsSince(payload.updatedAt),
          data: payload,
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataUniverse>(error, { symbols: [], source: "error", updatedAt: null });
    }
  }

  async handleUniverseRefresh(): Promise<MarketDataRouteResult<MarketDataUniverse>> {
    try {
      const payload = await this.loadOrRefreshUniverseArtifact(true);
      return {
        status: 200,
        body: {
          source: payload.source,
          status: "ok",
          degradedReason: null,
          stalenessSeconds: 0,
          data: payload,
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataUniverse>(error, { symbols: [], source: "error", updatedAt: null });
    }
  }

  async handleRiskHistory(request: Request): Promise<MarketDataRouteResult<MarketDataRiskHistory>> {
    const days = Math.max(parseInt(resolveQuery(request.url, "days", "90"), 10) || 90, 5);
    try {
      const payload = await this.buildRiskPayload(days);
      return {
        status: 200,
        body: {
          source: payload.meta.source,
          status: payload.meta.status,
          degradedReason: payload.meta.degradedReason ?? null,
          stalenessSeconds: payload.meta.stalenessSeconds,
          data: { rows: payload.rows as unknown as Array<Record<string, unknown>> },
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataRiskHistory>(error, { rows: [] });
    }
  }

  async handleRiskSnapshot(): Promise<MarketDataRouteResult<MarketDataRiskSnapshot>> {
    try {
      const payload = await this.buildRiskPayload(200);
      const latest = payload.rows[payload.rows.length - 1];
      const warnings = payload.warning ? [payload.warning] : [];
      const snapshot: MarketDataRiskSnapshot = {
        snapshotDate: latest?.date ?? new Date().toISOString(),
        mFactor: latest?.fear_greed ?? 50,
        vix: latest?.vix,
        putCall: latest?.put_call,
        hySpread: latest?.hy_spread,
        fearGreed: latest?.fear_greed,
        hySpreadSource: payload.hySpreadSource,
        hySpreadFallback: payload.hySpreadFallback,
        hySpreadWarning: payload.warning,
        warnings,
      };
      return {
        status: 200,
        body: {
          source: payload.meta.source,
          status: payload.meta.status,
          degradedReason: payload.meta.degradedReason ?? null,
          stalenessSeconds: payload.meta.stalenessSeconds,
          data: snapshot,
        },
      };
    } catch (error) {
      return this.toErrorRoute<MarketDataRiskSnapshot>(error, {
        snapshotDate: new Date().toISOString(),
        mFactor: 50,
        warnings: [],
      });
    }
  }

  private async fetchPrimaryHistory(symbol: string, period: string, interval: string): Promise<HistoryFetchResult> {
    const reasons: string[] = [];
    if (this.isSchwabConfigured()) {
      try {
        const rows = await this.fetchSchwabHistory(symbol, period, interval);
        return { source: "schwab", status: "ok", stalenessSeconds: 0, rows };
      } catch (error) {
        reasons.push(summarizeError(error));
        this.logger.error(`Schwab history failed for ${symbol}`, error);
      }
    }

    const rows = await this.fetchYahooHistory(symbol, period);
    return {
      source: "yahoo",
      status: reasons.length ? "degraded" : "ok",
      degradedReason: reasons.length ? `Schwab unavailable; using Yahoo fallback (${reasons[0]})` : null,
      stalenessSeconds: 0,
      rows,
    };
  }

  private async fetchPrimaryQuote(symbol: string): Promise<QuoteFetchResult> {
    const reasons: string[] = [];
    if (this.isSchwabConfigured()) {
      try {
        const quote = await this.fetchSchwabQuote(symbol);
        return { source: "schwab", status: "ok", stalenessSeconds: 0, quote };
      } catch (error) {
        reasons.push(summarizeError(error));
        this.logger.error(`Schwab quote failed for ${symbol}`, error);
      }
    }

    const quote = await this.fetchYahooQuote(symbol);
    return {
      source: "yahoo",
      status: reasons.length ? "degraded" : "ok",
      degradedReason: reasons.length ? `Schwab unavailable; using Yahoo fallback (${reasons[0]})` : null,
      stalenessSeconds: 0,
      quote,
    };
  }

  private async fetchPrimarySnapshot(symbol: string): Promise<SnapshotFetchResult> {
    const quote = await this.fetchPrimaryQuote(symbol);
    const [metadata, fundamentals] = await Promise.all([
      this.fetchYahooMetadata(symbol).catch(() => ({})),
      this.fetchYahooFundamentals(symbol).catch(() => ({})),
    ]);
    return {
      source: quote.source,
      status: quote.status,
      degradedReason: quote.degradedReason ?? null,
      stalenessSeconds: quote.stalenessSeconds,
      snapshot: {
        symbol,
        quote: quote.quote as unknown as Record<string, unknown>,
        metadata,
        fundamentals,
      },
    };
  }

  private async buildHistoryComparison(
    symbol: string,
    period: string,
    interval: string,
    compareWith: string | undefined,
    primaryRows: MarketDataHistoryPoint[],
  ): Promise<MarketDataComparison | undefined> {
    const source = normalizeCompare(compareWith);
    if (!source) {
      return undefined;
    }

    try {
      let rows: MarketDataHistoryPoint[];
      if (source === "schwab") {
        if (!this.isSchwabConfigured()) {
          return buildUnavailableCompare(source, "Schwab credentials are not configured");
        }
        rows = await this.fetchSchwabHistory(symbol, period, interval);
      } else if (source === "yahoo") {
        rows = await this.fetchYahooHistory(symbol, period);
      } else if (source === "alpaca") {
        rows = await this.fetchAlpacaHistory(symbol, period);
      } else {
        return buildUnavailableCompare(source, "Unsupported comparison provider");
      }

      return {
        source,
        available: true,
        mismatchSummary: compareHistoryRows(primaryRows, rows),
        stalenessSeconds: 0,
      };
    } catch (error) {
      return buildUnavailableCompare(source, summarizeError(error));
    }
  }

  private async buildQuoteComparison(
    symbol: string,
    compareWith: string | undefined,
    primaryQuote: MarketDataQuote | undefined,
  ): Promise<MarketDataComparison | undefined> {
    const source = normalizeCompare(compareWith);
    if (!source || !primaryQuote) {
      return undefined;
    }

    try {
      let quote: MarketDataQuote;
      if (source === "schwab") {
        if (!this.isSchwabConfigured()) {
          return buildUnavailableCompare(source, "Schwab credentials are not configured");
        }
        quote = await this.fetchSchwabQuote(symbol);
      } else if (source === "yahoo") {
        quote = await this.fetchYahooQuote(symbol);
      } else if (source === "alpaca") {
        quote = await this.fetchAlpacaQuote(symbol);
      } else {
        return buildUnavailableCompare(source, "Unsupported comparison provider");
      }

      return {
        source,
        available: true,
        mismatchSummary: compareQuotes(primaryQuote, quote),
        stalenessSeconds: 0,
      };
    } catch (error) {
      return buildUnavailableCompare(source, summarizeError(error));
    }
  }

  private async fetchYahooHistory(symbol: string, period: string): Promise<MarketDataHistoryPoint[]> {
    const range = normalizeYahooRange(period);
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
    url.searchParams.set("range", range);
    url.searchParams.set("interval", "1d");
    url.searchParams.set("includePrePost", "false");
    url.searchParams.set("events", "div,splits");

    const payload = await this.fetchJson<JsonRecord>(url.toString(), {
      headers: { "user-agent": YAHOO_USER_AGENT, accept: "application/json" },
    });
    const result = (((payload.chart as JsonRecord | undefined)?.result as JsonRecord[] | undefined) ?? [])[0] ?? {};
    const timestamps = ((result.timestamp as number[] | undefined) ?? []).map((value) => Number(value));
    const quote = ((((result.indicators as JsonRecord | undefined)?.quote as JsonRecord[] | undefined) ?? [])[0] ?? {}) as JsonRecord;
    const opens = toNumberArray(quote.open);
    const highs = toNumberArray(quote.high);
    const lows = toNumberArray(quote.low);
    const closes = toNumberArray(quote.close);
    const volumes = toNumberArray(quote.volume);
    const out: MarketDataHistoryPoint[] = [];
    for (let index = 0; index < timestamps.length; index += 1) {
      const open = opens[index];
      const high = highs[index];
      const low = lows[index];
      const close = closes[index];
      const volume = volumes[index];
      if ([open, high, low, close, volume].some((value) => value == null || Number.isNaN(value))) {
        continue;
      }
      out.push({
        timestamp: new Date(timestamps[index] * 1000).toISOString(),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      });
    }
    if (!out.length) {
      throw new Error(`Yahoo returned no usable history for ${symbol}`);
    }
    return out;
  }

  private async fetchYahooQuote(symbol: string): Promise<MarketDataQuote> {
    const url = new URL("https://query1.finance.yahoo.com/v7/finance/quote");
    url.searchParams.set("symbols", symbol);
    const payload = await this.fetchJson<JsonRecord>(url.toString(), {
      headers: { "user-agent": YAHOO_USER_AGENT, accept: "application/json" },
    });
    const result = ((((payload.quoteResponse as JsonRecord | undefined)?.result as JsonRecord[] | undefined) ?? [])[0] ?? {}) as JsonRecord;
    if (!Object.keys(result).length) {
      throw new Error(`Yahoo returned no quote for ${symbol}`);
    }
    return {
      symbol,
      price: toNumber(result.regularMarketPrice) ?? undefined,
      change: toNumber(result.regularMarketChange) ?? undefined,
      changePercent: toNumber(result.regularMarketChangePercent) ?? undefined,
      timestamp: result.regularMarketTime ? new Date(Number(result.regularMarketTime) * 1000).toISOString() : new Date().toISOString(),
      currency: typeof result.currency === "string" ? result.currency : undefined,
    };
  }

  private async fetchYahooMetadata(symbol: string): Promise<Record<string, unknown>> {
    const [quoteSummary, quote] = await Promise.all([
      this.fetchYahooQuoteSummary(symbol, ["summaryProfile", "defaultKeyStatistics", "financialData", "price"]),
      this.fetchYahooQuote(symbol).catch((): MarketDataQuote => ({ symbol })),
    ]);
    const summaryProfile = (quoteSummary.summaryProfile as JsonRecord | undefined) ?? {};
    const defaultKeyStats = (quoteSummary.defaultKeyStatistics as JsonRecord | undefined) ?? {};
    const price = (quoteSummary.price as JsonRecord | undefined) ?? {};
    return {
      name: firstString(price.shortName, price.longName, symbol),
      market_cap: unwrapYahooValue(firstValue(price.marketCap, defaultKeyStats.marketCap)),
      float_shares: unwrapYahooValue(defaultKeyStats.floatShares),
      beta: unwrapYahooValue(defaultKeyStats.beta),
      sector: firstString(summaryProfile.sector),
      industry: firstString(summaryProfile.industry),
      price: quote.price,
      change: quote.change,
      change_percent: quote.changePercent,
      currency: quote.currency,
    };
  }

  private async fetchYahooFundamentals(symbol: string, asOfDate?: string): Promise<Record<string, unknown>> {
    const summary = await this.fetchYahooQuoteSummary(symbol, [
      "summaryProfile",
      "defaultKeyStatistics",
      "financialData",
      "price",
      "calendarEvents",
      "earningsTrend",
    ]);
    const financialData = (summary.financialData as JsonRecord | undefined) ?? {};
    const defaultKeyStatistics = (summary.defaultKeyStatistics as JsonRecord | undefined) ?? {};
    const summaryProfile = (summary.summaryProfile as JsonRecord | undefined) ?? {};
    const calendarEvents = (summary.calendarEvents as JsonRecord | undefined) ?? {};
    const earnings = (calendarEvents.earnings as JsonRecord | undefined) ?? {};
    const earningsDates = ((earnings.earningsDate as JsonRecord[] | undefined) ?? [])
      .map((entry) => unwrapYahooValue(entry.fmt ?? entry.raw ?? entry.date))
      .filter((value): value is string => typeof value === "string");
    const eventWindow = earningsDates.map((date) => ({ date }));
    const earningsTrend = ((summary.earningsTrend as JsonRecord | undefined)?.trend as JsonRecord[] | undefined) ?? [];
    const annualGrowth = toNumber(unwrapYahooValue(earningsTrend[0]?.growth ?? financialData.earningsGrowth));
    const result: Record<string, unknown> = {
      symbol,
      as_of_date: asOfDate ?? new Date().toISOString().slice(0, 10),
      eps_growth: percentOrNone(unwrapYahooValue(financialData.earningsGrowth)),
      annual_eps_growth: percentOrNone(annualGrowth),
      revenue_growth: percentOrNone(unwrapYahooValue(financialData.revenueGrowth)),
      institutional_pct: toNumber(unwrapYahooValue(defaultKeyStatistics.heldPercentInstitutions)),
      float_shares: unwrapYahooValue(defaultKeyStatistics.floatShares),
      shares_outstanding: unwrapYahooValue(defaultKeyStatistics.sharesOutstanding),
      short_ratio: unwrapYahooValue(defaultKeyStatistics.shortRatio),
      short_pct_of_float: unwrapYahooValue(defaultKeyStatistics.shortPercentOfFloat),
      sector: firstString(summaryProfile.sector),
      industry: firstString(summaryProfile.industry),
      earnings_event_window: eventWindow,
      last_earnings_date: eventWindow.length ? String(eventWindow[eventWindow.length - 1]?.date ?? "") : null,
      next_earnings_date: eventWindow.length ? String(eventWindow[0]?.date ?? "") : null,
      earnings_history: [],
      quarterly_financials: [],
    };
    return result;
  }

  private async fetchYahooNews(symbol: string): Promise<Record<string, unknown>> {
    const url = new URL("https://query1.finance.yahoo.com/v1/finance/search");
    url.searchParams.set("q", symbol);
    url.searchParams.set("quotesCount", "0");
    url.searchParams.set("newsCount", "8");
    const payload = await this.fetchJson<JsonRecord>(url.toString(), {
      headers: { "user-agent": YAHOO_USER_AGENT, accept: "application/json" },
    });
    const news = ((payload.news as JsonRecord[] | undefined) ?? []).map((item) => ({
      title: firstString(item.title),
      publisher: firstString(item.publisher),
      link: firstString(item.link),
      summary: firstString(item.summary),
    }));
    return { items: news };
  }

  private async fetchYahooQuoteSummary(symbol: string, modules: string[]): Promise<JsonRecord> {
    const url = new URL(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`);
    url.searchParams.set("modules", modules.join(","));
    const payload = await this.fetchJson<JsonRecord>(url.toString(), {
      headers: { "user-agent": YAHOO_USER_AGENT, accept: "application/json" },
    });
    const result = ((((payload.quoteSummary as JsonRecord | undefined)?.result as JsonRecord[] | undefined) ?? [])[0] ?? {}) as JsonRecord;
    if (!Object.keys(result).length) {
      throw new Error(`Yahoo quoteSummary returned no data for ${symbol}`);
    }
    return result;
  }

  private isSchwabConfigured(): boolean {
    return Boolean(
      this.config.SCHWAB_CLIENT_ID.trim() &&
        this.config.SCHWAB_CLIENT_SECRET.trim() &&
        this.config.SCHWAB_REFRESH_TOKEN.trim(),
    );
  }

  private async fetchSchwabHistory(symbol: string, period: string, interval: string): Promise<MarketDataHistoryPoint[]> {
    const token = await this.getSchwabAccessToken();
    const params = mapSchwabPeriod(period, interval);
    const url = new URL(`${this.config.SCHWAB_API_BASE_URL.replace(/\/+$/, "")}/marketdata/v1/pricehistory`);
    url.searchParams.set("symbol", symbol);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    const payload = await this.fetchJson<JsonRecord>(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    });
    const candles = ((payload.candles as JsonRecord[] | undefined) ?? []).map((candle) => ({
      timestamp: new Date(Number(candle.datetime ?? 0)).toISOString(),
      open: toNumber(candle.open) ?? NaN,
      high: toNumber(candle.high) ?? NaN,
      low: toNumber(candle.low) ?? NaN,
      close: toNumber(candle.close) ?? NaN,
      volume: toNumber(candle.volume) ?? NaN,
    }));
    const rows = candles.filter((row) => !Object.values(row).some((value) => typeof value === "number" && Number.isNaN(value)));
    if (!rows.length) {
      throw new Error(`Schwab returned no candles for ${symbol}`);
    }
    return rows;
  }

  private async fetchSchwabQuote(symbol: string): Promise<MarketDataQuote> {
    const token = await this.getSchwabAccessToken();
    const url = new URL(`${this.config.SCHWAB_API_BASE_URL.replace(/\/+$/, "")}/marketdata/v1/quotes`);
    url.searchParams.set("symbols", symbol);
    url.searchParams.set("fields", "quote,fundamental");
    const payload = await this.fetchJson<JsonRecord>(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    });
    const candidate =
      (payload[symbol] as JsonRecord | undefined) ??
      (((payload.quotes as JsonRecord | undefined)?.[symbol] as JsonRecord | undefined) ?? {}) ??
      {};
    const quote = ((candidate.quote as JsonRecord | undefined) ?? candidate) as JsonRecord;
    if (!Object.keys(quote).length) {
      throw new Error(`Schwab returned no quote for ${symbol}`);
    }
    return {
      symbol,
      price: firstNumber(quote.lastPrice, quote.mark, quote.closePrice, quote.bidPrice),
      change: firstNumber(quote.netChange, quote.markChange),
      changePercent: firstNumber(quote.netPercentChange, quote.markPercentChange),
      timestamp: quote.tradeTimeInLong ? new Date(Number(quote.tradeTimeInLong)).toISOString() : new Date().toISOString(),
      currency: "USD",
    };
  }

  private async fetchAlpacaHistory(symbol: string, period: string): Promise<MarketDataHistoryPoint[]> {
    const keys = await this.getAlpacaKeys();
    const url = new URL(`${keys.data_url}/v2/stocks/${encodeURIComponent(symbol)}/bars`);
    url.searchParams.set("timeframe", "1Day");
    url.searchParams.set("limit", String(normalizeAlpacaBarLimit(period)));
    url.searchParams.set("adjustment", "raw");
    url.searchParams.set("feed", "iex");
    const payload = await this.fetchJson<JsonRecord>(url.toString(), {
      headers: {
        "APCA-API-KEY-ID": keys.key_id,
        "APCA-API-SECRET-KEY": keys.secret_key,
        accept: "application/json",
      },
    });
    const rows = ((payload.bars as JsonRecord[] | undefined) ?? [])
      .map((bar) => ({
        timestamp: String(bar.t ?? ""),
        open: toNumber(bar.o) ?? NaN,
        high: toNumber(bar.h) ?? NaN,
        low: toNumber(bar.l) ?? NaN,
        close: toNumber(bar.c) ?? NaN,
        volume: toNumber(bar.v) ?? NaN,
      }))
      .filter(
        (row) =>
          Boolean(row.timestamp) &&
          !Object.values(row).some((value) => typeof value === "number" && Number.isNaN(value)),
      );
    if (!rows.length) {
      throw new Error(`Alpaca returned no bars for ${symbol}`);
    }
    return rows;
  }

  private async fetchAlpacaQuote(symbol: string): Promise<MarketDataQuote> {
    const keys = await this.getAlpacaKeys();
    const tradeUrl = `${keys.data_url}/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=iex`;
    const tradePayload = await this.fetchJson<JsonRecord>(tradeUrl, {
      headers: {
        "APCA-API-KEY-ID": keys.key_id,
        "APCA-API-SECRET-KEY": keys.secret_key,
        accept: "application/json",
      },
    });
    const trade = (tradePayload.trade as JsonRecord | undefined) ?? {};
    const price = toNumber(trade.p);
    if (price == null) {
      throw new Error(`Alpaca returned no trade price for ${symbol}`);
    }
    return {
      symbol,
      price,
      timestamp: typeof trade.t === "string" ? trade.t : new Date().toISOString(),
      currency: "USD",
    };
  }

  private async getAlpacaKeys(): Promise<AlpacaKeys> {
    const envKeyId = (process.env.ALPACA_KEY ?? process.env.ALPACA_KEY_ID ?? "").trim();
    const envSecret = (process.env.ALPACA_SECRET_KEY ?? "").trim();
    const envDataUrl = (process.env.ALPACA_DATA_URL ?? "").trim();
    if (envKeyId && envSecret) {
      return {
        key_id: envKeyId,
        secret_key: envSecret,
        data_url: normalizeAlpacaDataUrl(envDataUrl || "https://data.alpaca.markets"),
      };
    }

    const keyPath = (process.env.ALPACA_KEYS_PATH ?? this.config.ALPACA_KEYS_PATH ?? "").trim() || path.join(os.homedir(), "Desktop", "services", "alpaca_keys.json");
    try {
      const raw = await fs.promises.readFile(keyPath, "utf8");
      const parsed = JSON.parse(raw) as JsonRecord;
      const keyId = String(parsed.key_id ?? "").trim();
      const secret = String(parsed.secret_key ?? "").trim();
      const dataUrl = normalizeAlpacaDataUrl(String(parsed.data_url ?? "https://data.alpaca.markets"));
      if (!keyId || !secret) {
        throw new Error("alpaca keys file is missing credentials");
      }
      return { key_id: keyId, secret_key: secret, data_url: dataUrl };
    } catch (error) {
      throw new Error(`Alpaca credentials unavailable: ${summarizeError(error)}`);
    }
  }

  private async getSchwabAccessToken(): Promise<string> {
    const cached = this.readCachedSchwabToken();
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.config.SCHWAB_REFRESH_TOKEN,
    });
    const auth = Buffer.from(`${this.config.SCHWAB_CLIENT_ID}:${this.config.SCHWAB_CLIENT_SECRET}`).toString("base64");
    const response = await this.fetchResponse(this.config.SCHWAB_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
    });
    const payload = await readJsonResponse<JsonRecord>(response);
    const accessToken = String(payload.access_token ?? "").trim();
    const expiresIn = Number(payload.expires_in ?? 1800);
    if (!accessToken) {
      throw new Error("Schwab token refresh returned no access token");
    }
    this.writeCachedSchwabToken({
      accessToken,
      expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000,
    });
    return accessToken;
  }

  private readCachedSchwabToken(): CachedTokenPayload | null {
    try {
      const raw = fs.readFileSync(this.schwabTokenPath, "utf8");
      const payload = JSON.parse(raw) as CachedTokenPayload;
      if (!payload.accessToken || !payload.expiresAt) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  private writeCachedSchwabToken(payload: CachedTokenPayload): void {
    try {
      fs.mkdirSync(path.dirname(this.schwabTokenPath), { recursive: true });
      fs.writeFileSync(this.schwabTokenPath, JSON.stringify(payload, null, 2));
    } catch (error) {
      this.logger.error("Unable to persist Schwab token cache", error);
    }
  }

  private async loadOrRefreshUniverseArtifact(forceRefresh: boolean): Promise<MarketDataUniverse> {
    const artifactPath = path.join(this.cacheDir, "base-universe.json");
    if (!forceRefresh) {
      const cached = readJsonFile<MarketDataUniverse>(artifactPath);
      const cachedAgeSeconds = cached?.updatedAt ? this.secondsSince(cached.updatedAt) : null;
      if (cached?.updatedAt && cachedAgeSeconds != null && cachedAgeSeconds < 24 * 3600) {
        return cached;
      }
    }

    const symbols = await this.seedUniverseFromPython();
    const payload: MarketDataUniverse = {
      symbols,
      source: "static_python_seed",
      updatedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, JSON.stringify(payload, null, 2));
    return payload;
  }

  private async seedUniverseFromPython(): Promise<string[]> {
    const raw = await fs.promises.readFile(this.universeSeedPath, "utf8");
    const start = raw.indexOf("SP500_TICKERS = [");
    if (start < 0) {
      throw new Error(`Unable to locate SP500_TICKERS in ${this.universeSeedPath}`);
    }
    const end = raw.indexOf("]\n\n# Growth", start);
    const block = raw.slice(start, end > start ? end : undefined);
    const matches = [...block.matchAll(/"([A-Z0-9.\-^]+)"/g)].map((match) => match[1].replaceAll(".", "-"));
    return dedupe(matches);
  }

  private async buildRiskPayload(days: number): Promise<{
    rows: RiskRow[];
    meta: ServiceMetadata;
    warning: string;
    hySpreadSource: string;
    hySpreadFallback: boolean;
  }> {
    const lookbackDays = Math.max(days, 160) * 2;
    const [vixHistory, spyHistory, hySeries, putCallSeries] = await Promise.all([
      this.fetchYahooHistory("^VIX", "1y").catch(() => []),
      this.fetchYahooHistory("SPY", "1y").catch(() => []),
      this.fetchFredSeries("BAMLH0A0HYM2", lookbackDays).catch(() => []),
      this.fetchPutCallHistory(lookbackDays).catch(() => []),
    ]);

    const baseDates = dedupe([
      ...spyHistory.map((row) => row.timestamp.slice(0, 10)),
      ...vixHistory.map((row) => row.timestamp.slice(0, 10)),
      ...hySeries.map((row) => row.date),
      ...putCallSeries.map((row) => row.date),
    ]).sort();
    if (!baseDates.length) {
      throw new Error("Unable to build risk payload from upstream sources");
    }

    const vixMap = buildSeriesMap(vixHistory.map((row) => ({ date: row.timestamp.slice(0, 10), value: row.close })));
    const spyMap = buildSeriesMap(spyHistory.map((row) => ({ date: row.timestamp.slice(0, 10), value: row.close })));
    const hyMap = buildSeriesMap(hySeries);
    const putCallMap = buildSeriesMap(putCallSeries);

    const rows: RiskRow[] = [];
    let lastVix = 20;
    let lastSpy = 500;
    let lastHy = 450;
    let lastPutCall = 1;
    const hySpreadFallback = !hySeries.length;
    const warning = hySpreadFallback
      ? "FRED HY spread unavailable; using neutral 450 bps fallback."
      : "";
    for (const date of baseDates) {
      lastVix = vixMap.get(date) ?? lastVix;
      lastSpy = spyMap.get(date) ?? lastSpy;
      lastHy = hyMap.get(date) ?? lastHy;
      lastPutCall = putCallMap.get(date) ?? lastPutCall;
      rows.push({
        date,
        vix: lastVix,
        spy_close: lastSpy,
        hy_spread: lastHy,
        put_call: clamp(lastPutCall, 0.3, 3.0),
        vix_percentile: 0,
        hy_spread_percentile: 0,
        spy_distance_score: 50,
        fear_greed: 50,
      });
    }

    const vixValues = rows.map((row) => row.vix);
    const hyValues = rows.map((row) => row.hy_spread);
    const spyValues = rows.map((row) => row.spy_close);
    const vixPercentiles = percentileArray(vixValues);
    const hyPercentiles = percentileArray(hyValues);
    const spyDistanceScores = spyDistanceScoresFromClose(spyValues);
    for (let index = 0; index < rows.length; index += 1) {
      rows[index].vix_percentile = vixPercentiles[index];
      rows[index].hy_spread_percentile = hyPercentiles[index];
      rows[index].spy_distance_score = spyDistanceScores[index];
      rows[index].fear_greed = clamp((vixPercentiles[index] + hyPercentiles[index] + spyDistanceScores[index]) / 3, 0, 100);
    }

    return {
      rows: rows.slice(-days),
      meta: {
        source: "ts-risk-stack",
        status: hySpreadFallback ? "degraded" : "ok",
        degradedReason: hySpreadFallback ? warning : null,
        stalenessSeconds: 0,
      },
      warning,
      hySpreadSource: hySpreadFallback ? "fallback_default_450" : "fred",
      hySpreadFallback,
    };
  }

  private async fetchFredSeries(seriesId: string, lookbackDays: number): Promise<Array<{ date: string; value: number }>> {
    const end = new Date();
    const start = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    const url = new URL("https://api.stlouisfed.org/fred/series/observations");
    url.searchParams.set("series_id", seriesId);
    url.searchParams.set("file_type", "json");
    url.searchParams.set("observation_start", start.toISOString().slice(0, 10));
    url.searchParams.set("observation_end", end.toISOString().slice(0, 10));
    if (this.config.FRED_API_KEY.trim()) {
      url.searchParams.set("api_key", this.config.FRED_API_KEY.trim());
    }
    const payload = await this.fetchJson<JsonRecord>(url.toString(), {
      headers: { accept: "application/json" },
    });
    const observations = ((payload.observations as JsonRecord[] | undefined) ?? [])
      .map((row) => ({
        date: String(row.date ?? ""),
        value: toNumber(row.value),
      }))
      .filter((row): row is { date: string; value: number } => Boolean(row.date) && row.value != null);
    return observations;
  }

  private async fetchPutCallHistory(lookbackDays: number): Promise<Array<{ date: string; value: number }>> {
    const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    for (const endpoint of CBOE_ENDPOINTS) {
      try {
        const response = await this.fetchResponse(endpoint, { headers: { accept: "*/*" } }, 10_000);
        if (!response.ok) {
          continue;
        }
        const contentType = response.headers.get("content-type") ?? "";
        const body = await response.text();
        const rows = contentType.includes("json") || endpoint.endsWith(".json")
          ? parsePutCallJson(body)
          : parsePutCallCsv(body);
        const filtered = rows.filter((row) => row.date >= startDate);
        if (filtered.length) {
          return filtered.map((row) => ({ date: row.date, value: clamp(row.value, 0.3, 3.0) }));
        }
      } catch {
        continue;
      }
    }
    return [];
  }

  private async fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchResponse(url, { ...init }, this.requestTimeoutMs);
    if (!response.ok) {
      const body = await response.text();
      throw new HttpError(`HTTP ${response.status}`, response.status, body);
    }
    return (await response.json()) as T;
  }

  private async fetchResponse(input: string | URL, init: RequestInit = {}, timeoutMs = this.requestTimeoutMs): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(input, { ...init, signal: init.signal ?? controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private secondsSince(value: string | null | undefined): number | null {
    if (!value) {
      return null;
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return null;
    }
    return Math.max(Math.round((Date.now() - parsed) / 1000), 0);
  }

  private toErrorRoute<T>(error: unknown, data: T): MarketDataRouteResult<T> {
    return {
      status: 503,
      body: {
        source: "service",
        status: "error",
        degradedReason: summarizeError(error),
        stalenessSeconds: null,
        data,
      },
    };
  }
}

export function normalizeMarketSymbol(rawSymbol: string): string {
  return String(rawSymbol).trim().toUpperCase();
}

function normalizeCompare(rawCompareWith: string | undefined): string | undefined {
  const candidate = rawCompareWith?.trim().toLowerCase();
  if (!candidate) {
    return undefined;
  }
  if (!["alpaca", "yahoo", "schwab", "cache"].includes(candidate)) {
    return undefined;
  }
  return candidate;
}

function normalizeAlpacaDataUrl(rawUrl: string): string {
  return rawUrl.trim().replace(/\/+$/, "") || "https://data.alpaca.markets";
}

function normalizeAlpacaBarLimit(period: string): number {
  const candidate = period.trim().toLowerCase();
  const mapping: Record<string, number> = {
    "5d": 5,
    "1mo": 22,
    "3mo": 66,
    "6mo": 132,
    "1y": 252,
    "2y": 504,
    "5y": 1000,
  };
  return mapping[candidate] ?? 252;
}

function resolveQuery(url: string, key: string, defaultValue: string): string {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get(key) ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

function marketDataErrorResponse<T>(
  message: string,
  status: MarketDataStatus,
  options: { reason: string },
): MarketDataResponse<T> {
  return {
    source: "service",
    status,
    degradedReason: message,
    stalenessSeconds: null,
    data: { error: options.reason } as T,
  };
}

function buildUnavailableCompare(source: string, message: string): MarketDataComparison {
  return {
    source,
    available: false,
    mismatchSummary: message,
    stalenessSeconds: null,
  };
}

function toNumberArray(value: unknown): Array<number | null> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => toNumber(item));
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numeric = toNumber(value);
    if (numeric != null) {
      return numeric;
    }
  }
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function firstValue(...values: unknown[]): unknown {
  for (const value of values) {
    if (value != null) {
      return value;
    }
  }
  return undefined;
}

function unwrapYahooValue(value: unknown): unknown {
  if (value && typeof value === "object" && "raw" in (value as JsonRecord)) {
    return (value as JsonRecord).raw;
  }
  return value;
}

function normalizeYahooRange(period: string): string {
  const normalized = period.trim().toLowerCase();
  const supported = new Set(["5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"]);
  if (supported.has(normalized)) {
    return normalized;
  }
  if (normalized.endsWith("d")) {
    return normalized;
  }
  if (normalized.endsWith("mo")) {
    return normalized;
  }
  if (normalized.endsWith("y")) {
    return normalized;
  }
  return "1y";
}

function mapSchwabPeriod(period: string, _interval: string): Record<string, string | number> {
  const normalized = period.trim().toLowerCase();
  if (normalized.endsWith("d")) {
    const days = Math.max(parseInt(normalized.slice(0, -1), 10) || 5, 1);
    return {
      periodType: "day",
      period: Math.min(days, 10),
      frequencyType: "daily",
      frequency: 1,
      needExtendedHoursData: "false",
      needPreviousClose: "true",
    };
  }
  if (normalized.endsWith("mo")) {
    const months = Math.max(parseInt(normalized.slice(0, -2), 10) || 1, 1);
    return {
      periodType: "month",
      period: Math.min(months, 6),
      frequencyType: "daily",
      frequency: 1,
      needExtendedHoursData: "false",
      needPreviousClose: "true",
    };
  }
  const years = Math.max(parseInt(normalized.replace(/[^0-9]/g, ""), 10) || 1, 1);
  return {
    periodType: "year",
    period: Math.min(years, 20),
    frequencyType: "daily",
    frequency: 1,
    needExtendedHoursData: "false",
    needPreviousClose: "true",
  };
}

function compareHistoryRows(primaryRows: MarketDataHistoryPoint[], comparisonRows: MarketDataHistoryPoint[]): string {
  if (!primaryRows.length || !comparisonRows.length) {
    return "one provider returned no rows";
  }
  const primaryLatest = primaryRows[primaryRows.length - 1];
  const compareLatest = comparisonRows[comparisonRows.length - 1];
  const closeDelta = ((primaryLatest.close - compareLatest.close) / compareLatest.close) * 100;
  return `latest close delta ${closeDelta.toFixed(2)}% | rows ${primaryRows.length} vs ${comparisonRows.length}`;
}

function compareQuotes(primaryQuote: MarketDataQuote, comparisonQuote: MarketDataQuote): string {
  const primaryPrice = primaryQuote.price ?? 0;
  const comparisonPrice = comparisonQuote.price ?? 0;
  if (!comparisonPrice) {
    return "comparison quote missing price";
  }
  const delta = ((primaryPrice - comparisonPrice) / comparisonPrice) * 100;
  return `price delta ${delta.toFixed(2)}%`;
}

function percentOrNone(value: unknown): number | null {
  const numeric = toNumber(value);
  if (numeric == null) {
    return null;
  }
  if (Math.abs(numeric) <= 2) {
    return numeric * 100;
  }
  return numeric;
}

function resolveRepoPath(rawPath: string): string {
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  return path.join(repoRoot, rawPath);
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function buildSeriesMap(rows: Array<{ date: string; value: number }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.date && Number.isFinite(row.value)) {
      out.set(row.date, row.value);
    }
  }
  return out;
}

function percentileArray(values: number[]): number[] {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => a.value - b.value);
  const out = Array.from({ length: values.length }, () => 50);
  sorted.forEach((item, index) => {
    out[item.index] = ((index + 1) / sorted.length) * 100;
  });
  return out;
}

function spyDistanceScoresFromClose(close: number[]): number[] {
  const out: number[] = [];
  for (let index = 0; index < close.length; index += 1) {
    const window = close.slice(Math.max(0, index - 124), index + 1);
    const average = window.reduce((sum, value) => sum + value, 0) / window.length;
    const distancePct = average ? ((average - close[index]) / average) * 100 : 0;
    out.push(clamp(((distancePct + 10) / 20) * 100, 0, 100));
  }
  return out;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parsePutCallCsv(body: string): Array<{ date: string; value: number }> {
  const [headerLine, ...lines] = body.split(/\r?\n/).filter(Boolean);
  if (!headerLine) {
    return [];
  }
  const headers = headerLine.split(",").map((value) => value.trim());
  const dateIndex = headers.findIndex((value) => value.toLowerCase().includes("date"));
  const ratioIndex = headers.findIndex((value) => {
    const lowered = value.toLowerCase();
    return lowered.includes("ratio") || lowered.includes("put/call") || lowered.includes("put_call") || lowered.includes("p/c");
  });
  if (dateIndex < 0 || ratioIndex < 0) {
    return [];
  }
  return lines
    .map((line) => line.split(","))
    .map((parts) => ({ date: parts[dateIndex]?.trim() ?? "", value: Number(parts[ratioIndex]) }))
    .filter((row) => row.date && Number.isFinite(row.value));
}

function parsePutCallJson(body: string): Array<{ date: string; value: number }> {
  try {
    const payload = JSON.parse(body) as JsonRecord;
    const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload) ? (payload as unknown as JsonRecord[]) : [];
    return rows
      .map((row) => ({
        date: String(firstValue(row.date, row.tradeDate, row.asOfDate) ?? ""),
        value: toNumber(firstValue(row.putCallRatio, row.put_call_ratio, row.totalPutCallRatio)) ?? NaN,
      }))
      .filter((row) => row.date && Number.isFinite(row.value));
  } catch {
    return [];
  }
}
