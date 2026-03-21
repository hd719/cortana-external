import type { AppLogger } from "../lib/logger.js";
import type { MarketDataQuote } from "./types.js";

export interface SchwabStreamerPreferences {
  streamerSocketUrl: string;
  schwabClientCustomerId: string;
  schwabClientCorrelId: string;
  schwabClientChannel: string;
  schwabClientFunctionId: string;
}

export interface SchwabStreamerSessionOptions {
  logger: AppLogger;
  websocketFactory?: WebSocketFactory;
  accessTokenProvider: () => Promise<string>;
  preferencesProvider: () => Promise<SchwabStreamerPreferences>;
  subscriptionFields?: string;
  connectTimeoutMs?: number;
  quoteWaitTimeoutMs?: number;
  freshnessTtlMs?: number;
}

export interface WebSocketLike {
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

interface CachedQuote {
  quote: MarketDataQuote;
  receivedAt: number;
}

export interface StreamerChartEquityPoint {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sequence?: number;
  chartTime: string;
}

interface CachedChartPoint {
  point: StreamerChartEquityPoint;
  receivedAt: number;
}

interface StreamerResponseContent {
  code?: number;
  msg?: string;
}

export class SchwabStreamerSession {
  private readonly logger: AppLogger;
  private readonly websocketFactory: WebSocketFactory;
  private readonly accessTokenProvider: () => Promise<string>;
  private readonly preferencesProvider: () => Promise<SchwabStreamerPreferences>;
  private readonly equitySubscriptionFields: string;
  private readonly chartSubscriptionFields: string;
  private readonly connectTimeoutMs: number;
  private readonly quoteWaitTimeoutMs: number;
  private readonly freshnessTtlMs: number;
  private ws: WebSocketLike | null = null;
  private connectPromise: Promise<void> | null = null;
  private loginResolve: (() => void) | null = null;
  private loginReject: ((error: Error) => void) | null = null;
  private readonly subscribedEquitySymbols = new Set<string>();
  private readonly subscribedChartSymbols = new Set<string>();
  private readonly quoteCache = new Map<string, CachedQuote>();
  private readonly chartCache = new Map<string, CachedChartPoint>();
  private lastMessageAt = 0;
  private requestCounter = 0;
  private currentPreferences: SchwabStreamerPreferences | null = null;

  constructor(options: SchwabStreamerSessionOptions) {
    this.logger = options.logger;
    this.websocketFactory = options.websocketFactory ?? defaultWebSocketFactory;
    this.accessTokenProvider = options.accessTokenProvider;
    this.preferencesProvider = options.preferencesProvider;
    this.equitySubscriptionFields = options.subscriptionFields ?? "0,1,2,3,34";
    this.chartSubscriptionFields = "0,1,2,3,4,5,6,7";
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
    this.quoteWaitTimeoutMs = options.quoteWaitTimeoutMs ?? 750;
    this.freshnessTtlMs = options.freshnessTtlMs ?? 15_000;
  }

  async getQuote(symbol: string): Promise<MarketDataQuote | null> {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) {
      return null;
    }
    const cached = this.getFreshQuote(normalized);
    if (cached) {
      return cached;
    }

    await this.ensureConnectedAndSubscribed([normalized], []);
    const deadline = Date.now() + this.quoteWaitTimeoutMs;
    while (Date.now() < deadline) {
      const next = this.getFreshQuote(normalized);
      if (next) {
        return next;
      }
      await sleep(50);
    }
    return this.getFreshQuote(normalized);
  }

  async getChartEquity(symbol: string): Promise<StreamerChartEquityPoint | null> {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) {
      return null;
    }
    const cached = this.getFreshChart(normalized);
    if (cached) {
      return cached;
    }

    await this.ensureConnectedAndSubscribed([], [normalized]);
    const deadline = Date.now() + this.quoteWaitTimeoutMs;
    while (Date.now() < deadline) {
      const next = this.getFreshChart(normalized);
      if (next) {
        return next;
      }
      await sleep(50);
    }
    return this.getFreshChart(normalized);
  }

  close(): void {
    try {
      this.ws?.close(1000, "shutdown");
    } catch {
      // ignore close races
    } finally {
      this.ws = null;
      this.connectPromise = null;
      this.loginResolve = null;
      this.loginReject = null;
    }
  }

  private getFreshQuote(symbol: string): MarketDataQuote | null {
    const cached = this.quoteCache.get(symbol);
    if (!cached) {
      return null;
    }
    if (Date.now() - cached.receivedAt > this.freshnessTtlMs) {
      return null;
    }
    return cached.quote;
  }

  private getFreshChart(symbol: string): StreamerChartEquityPoint | null {
    const cached = this.chartCache.get(symbol);
    if (!cached) {
      return null;
    }
    if (Date.now() - cached.receivedAt > this.freshnessTtlMs) {
      return null;
    }
    return cached.point;
  }

  private async ensureConnectedAndSubscribed(equitySymbols: string[], chartSymbols: string[]): Promise<void> {
    await this.ensureConnected();
    const wantedEquities = new Set([
      ...this.subscribedEquitySymbols,
      ...equitySymbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
    ]);
    const equitiesChanged =
      wantedEquities.size !== this.subscribedEquitySymbols.size ||
      [...wantedEquities].some((symbol) => !this.subscribedEquitySymbols.has(symbol));
    if (equitiesChanged) {
      this.subscribedEquitySymbols.clear();
      wantedEquities.forEach((symbol) => this.subscribedEquitySymbols.add(symbol));
      this.sendRequest({
        service: "LEVELONE_EQUITIES",
        command: "SUBS",
        parameters: {
          keys: [...this.subscribedEquitySymbols].join(","),
          fields: this.equitySubscriptionFields,
        },
      });
    }

    const wantedCharts = new Set([
      ...this.subscribedChartSymbols,
      ...chartSymbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
    ]);
    const chartsChanged =
      wantedCharts.size !== this.subscribedChartSymbols.size ||
      [...wantedCharts].some((symbol) => !this.subscribedChartSymbols.has(symbol));
    if (chartsChanged) {
      this.subscribedChartSymbols.clear();
      wantedCharts.forEach((symbol) => this.subscribedChartSymbols.add(symbol));
      this.sendRequest({
        service: "CHART_EQUITY",
        command: "SUBS",
        parameters: {
          keys: [...this.subscribedChartSymbols].join(","),
          fields: this.chartSubscriptionFields,
        },
      });
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws && this.ws.readyState === 1 && Date.now() - this.lastMessageAt <= this.freshnessTtlMs) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    this.connectPromise = this.connect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async connect(): Promise<void> {
    const [preferences, accessToken] = await Promise.all([this.preferencesProvider(), this.accessTokenProvider()]);
    this.currentPreferences = preferences;
    const ws = this.websocketFactory(preferences.streamerSocketUrl);
    this.ws = ws;
    this.lastMessageAt = Date.now();

    const opened = await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Schwab streamer open timeout")), this.connectTimeoutMs);
      ws.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Schwab streamer connection failed"));
      };
      ws.onclose = (event) => {
        clearTimeout(timeout);
        reject(new Error(`Schwab streamer closed during connect (${event.code ?? "unknown"})`));
      };
    });
    await opened;

    ws.onmessage = (event) => this.handleMessage(event.data);
    ws.onerror = (event) => {
      this.logger.error("schwab streamer error", event);
    };
    ws.onclose = (event) => {
      this.logger.error("schwab streamer closed", { code: event.code, reason: event.reason });
      this.ws = null;
      this.loginResolve = null;
      this.loginReject = null;
    };

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Schwab streamer login timeout")), this.connectTimeoutMs);
      this.loginResolve = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.loginReject = (error) => {
        clearTimeout(timeout);
        reject(error);
      };
      this.sendRequest({
        service: "ADMIN",
        command: "LOGIN",
        parameters: {
          Authorization: accessToken,
          SchwabClientChannel: preferences.schwabClientChannel,
          SchwabClientFunctionId: preferences.schwabClientFunctionId,
        },
      });
    });
  }

  private sendRequest(input: {
    service: string;
    command: string;
    parameters: Record<string, string>;
  }): void {
    if (!this.ws || this.ws.readyState !== 1 || !this.currentPreferences) {
      throw new Error("Schwab streamer is not connected");
    }
    this.requestCounter += 1;
    const payload = {
      requests: [
        {
          requestid: String(this.requestCounter),
          service: input.service,
          command: input.command,
          SchwabClientCustomerId: this.currentPreferences.schwabClientCustomerId,
          SchwabClientCorrelId: this.currentPreferences.schwabClientCorrelId,
          parameters: input.parameters,
        },
      ],
    };
    this.ws.send(JSON.stringify(payload));
  }

  private handleMessage(raw: string): void {
    this.lastMessageAt = Date.now();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const responses = Array.isArray(payload.response) ? payload.response : [];
    for (const response of responses) {
      const entry = response as Record<string, unknown>;
      if (String(entry.service ?? "") !== "ADMIN" || String(entry.command ?? "") !== "LOGIN") {
        continue;
      }
      const content = (entry.content ?? {}) as StreamerResponseContent;
      if (Number(content.code ?? -1) === 0) {
        this.loginResolve?.();
        this.loginResolve = null;
        this.loginReject = null;
      } else {
        this.loginReject?.(new Error(`Schwab streamer login failed: ${content.msg ?? "unknown error"}`));
        this.loginResolve = null;
        this.loginReject = null;
      }
    }

    const dataEntries = Array.isArray(payload.data) ? payload.data : [];
    for (const item of dataEntries) {
      const entry = item as Record<string, unknown>;
      const content = Array.isArray(entry.content) ? entry.content : [];
      const service = String(entry.service ?? "");
      if (service === "LEVELONE_EQUITIES") {
        for (const row of content) {
          const normalized = normalizeStreamerEquityQuote(row as Record<string, unknown>, Number(entry.timestamp ?? Date.now()));
          if (normalized) {
            this.quoteCache.set(normalized.symbol, {
              quote: normalized,
              receivedAt: Date.now(),
            });
          }
        }
      } else if (service === "CHART_EQUITY") {
        for (const row of content) {
          const normalized = normalizeStreamerChartEquity(row as Record<string, unknown>);
          if (normalized) {
            this.chartCache.set(normalized.symbol, {
              point: normalized,
              receivedAt: Date.now(),
            });
          }
        }
      }
    }
  }
}

function normalizeStreamerEquityQuote(row: Record<string, unknown>, fallbackTimestamp: number): MarketDataQuote | null {
  const symbol = String(row.key ?? row.symbol ?? "").trim().toUpperCase();
  if (!symbol) {
    return null;
  }
  const price = firstNumber(row["3"], row["2"], row["1"]);
  if (price == null) {
    return null;
  }
  const timestampMs = firstNumber(row["34"], row["35"], row["37"]) ?? fallbackTimestamp;
  return {
    symbol,
    price,
    timestamp: new Date(timestampMs).toISOString(),
    currency: "USD",
  };
}

function normalizeStreamerChartEquity(row: Record<string, unknown>): StreamerChartEquityPoint | null {
  const symbol = String(row["0"] ?? row.key ?? "").trim().toUpperCase();
  const open = firstNumber(row["1"]);
  const high = firstNumber(row["2"]);
  const low = firstNumber(row["3"]);
  const close = firstNumber(row["4"]);
  const volume = firstNumber(row["5"]);
  const chartTimeMs = firstNumber(row["7"]);
  if (!symbol || open == null || high == null || low == null || close == null || volume == null || chartTimeMs == null) {
    return null;
  }
  return {
    symbol,
    open,
    high,
    low,
    close,
    volume,
    sequence: firstNumber(row["6"]),
    chartTime: new Date(chartTimeMs).toISOString(),
  };
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  const ctor = (globalThis as typeof globalThis & { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  if (!ctor) {
    throw new Error("Global WebSocket is not available in this runtime");
  }
  return new ctor(url) as unknown as WebSocketLike;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
