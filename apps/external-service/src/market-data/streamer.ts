import type { AppLogger } from "../lib/logger.js";
import type { MarketDataFuturesQuote, MarketDataQuote, SchwabAccountActivityEvent } from "./types.js";
import {
  isSupportedFuturesSymbol,
  normalizeStreamerAccountActivityEvent,
  normalizeStreamerFuturesQuote,
  normalizeStreamerChartEquity,
  normalizeStreamerEquityQuote,
  STREAMER_SERVICES,
  type StreamerServiceName,
} from "./streamer-fields.js";

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
  futuresSubscriptionFields?: string;
  cacheSoftCap?: number;
  connectTimeoutMs?: number;
  quoteWaitTimeoutMs?: number;
  freshnessTtlMs?: number;
  heartbeatTimeoutMs?: number;
  subscriptionIdleTtlMs?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  reconnectJitterMs?: number;
  viewReconciliationIntervalMs?: number;
  supervisionIntervalMs?: number;
  subscriptionSoftCap?: number;
  accountActivityEnabled?: boolean;
  stateSink?: (state: SharedStreamerState) => void;
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

interface CachedQuote<T> {
  quote: T;
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

interface SubscriptionEntry {
  symbol: string;
  lastRequestedAt: number;
  active: boolean;
}

interface PendingRequestMeta {
  requestId: string;
  service: string;
  command: string;
  symbols: string[];
  fields: string | null;
  requestedAt: number;
}

interface PendingAck {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface PendingDataWaiter<T> {
  resolve: (value: T | null) => void;
  timeout: NodeJS.Timeout;
}

interface StreamerServiceReconciliation {
  intendedSymbols: number;
  activeSymbols: number;
  confirmedSymbols: number;
  symbolDriftCount: number;
  requestedFields: string | null;
  confirmedFields: string | null;
  fieldsMatch: boolean;
  lastAckAt: string | null;
}

interface StreamerServiceBudget {
  requestedSymbols: number;
  softCap: number;
  headroomRemaining: number;
  overSoftCap: boolean;
  lastPrunedAt: string | null;
  lastPrunedCount: number;
}

interface SharedCachedQuote {
  quote: MarketDataQuote;
  receivedAt: string;
}

interface SharedCachedChartPoint {
  point: StreamerChartEquityPoint;
  receivedAt: string;
}

interface SharedCachedFuturesQuote {
  quote: MarketDataFuturesQuote;
  receivedAt: string;
}

interface CachedAccountActivityEvent {
  event: SchwabAccountActivityEvent;
  receivedAt: number;
}

interface SharedCachedAccountActivityEvent {
  event: SchwabAccountActivityEvent;
  receivedAt: string;
}

const ACCOUNT_ACTIVITY_EVENT_BUFFER_LIMIT = 10;

export interface SchwabStreamerHealth {
  enabled: boolean;
  connected: boolean;
  lastMessageAt: string | null;
  lastHeartbeatAt: string | null;
  lastLoginAt: string | null;
  lastDisconnectAt: string | null;
  lastDisconnectReason: string | null;
  reconnectAttempts: number;
  reconnectFailureStreak: number;
  lastFailureCode: number | null;
  lastFailureMessage: string | null;
  failurePolicy: string | null;
  operatorState: string;
  operatorAction: string;
  reconnectSuppressed: boolean;
  nextReconnectAt: string | null;
  lastViewReconciliationAt: string | null;
  activeSubscriptions: Record<string, number>;
  requestedSubscriptions: Record<string, number>;
  reconciliation: Record<string, StreamerServiceReconciliation>;
  subscriptionBudget: Record<string, StreamerServiceBudget>;
  staleSymbolCount: number;
  messageRatePerMinute: number;
  stale: boolean;
  recentAccountActivityEvents: SchwabAccountActivityEvent[];
  recentFuturesQuotes: MarketDataFuturesQuote[];
}

export interface SharedStreamerState {
  updatedAt: string;
  health: SchwabStreamerHealth;
  quotes: Record<string, SharedCachedQuote>;
  futuresQuotes: Record<string, SharedCachedFuturesQuote>;
  charts: Record<string, SharedCachedChartPoint>;
  recentAccountActivityEvents: SharedCachedAccountActivityEvent[];
}

export class SchwabStreamerSession {
  private readonly logger: AppLogger;
  private readonly websocketFactory: WebSocketFactory;
  private readonly accessTokenProvider: () => Promise<string>;
  private readonly preferencesProvider: () => Promise<SchwabStreamerPreferences>;
  private readonly equitySubscriptionFields: string;
  private readonly futuresSubscriptionFields: string;
  private readonly chartSubscriptionFields: string;
  private readonly cacheSoftCap: number;
  private readonly connectTimeoutMs: number;
  private readonly quoteWaitTimeoutMs: number;
  private readonly freshnessTtlMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly subscriptionIdleTtlMs: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly reconnectJitterMs: number;
  private readonly viewReconciliationIntervalMs: number;
  private readonly stateSink?: (state: SharedStreamerState) => void;
  private readonly subscriptionSoftCap: number;
  private readonly accountActivityEnabled: boolean;
  private ws: WebSocketLike | null = null;
  private connectPromise: Promise<void> | null = null;
  private loginResolve: (() => void) | null = null;
  private loginReject: ((error: Error) => void) | null = null;
  private readonly subscriptions: Record<StreamerServiceName, Map<string, SubscriptionEntry>> = {
    [STREAMER_SERVICES.LEVELONE_EQUITIES]: new Map(),
    [STREAMER_SERVICES.LEVELONE_FUTURES]: new Map(),
    [STREAMER_SERVICES.CHART_EQUITY]: new Map(),
    [STREAMER_SERVICES.ACCT_ACTIVITY]: new Map(),
  };
  private readonly activeSubscriptions: Record<StreamerServiceName, Set<string>> = {
    [STREAMER_SERVICES.LEVELONE_EQUITIES]: new Set(),
    [STREAMER_SERVICES.LEVELONE_FUTURES]: new Set(),
    [STREAMER_SERVICES.CHART_EQUITY]: new Set(),
    [STREAMER_SERVICES.ACCT_ACTIVITY]: new Set(),
  };
  private readonly quoteCache = new Map<string, CachedQuote<MarketDataQuote>>();
  private readonly futuresCache = new Map<string, CachedQuote<MarketDataFuturesQuote>>();
  private readonly chartCache = new Map<string, CachedChartPoint>();
  private readonly accountActivityEvents: CachedAccountActivityEvent[] = [];
  private readonly pendingRequests = new Map<string, PendingRequestMeta>();
  private readonly pendingAcks = new Map<string, PendingAck>();
  private readonly quoteWaiters = new Map<string, Set<PendingDataWaiter<MarketDataQuote>>>();
  private readonly futuresWaiters = new Map<string, Set<PendingDataWaiter<MarketDataFuturesQuote>>>();
  private readonly chartWaiters = new Map<string, Set<PendingDataWaiter<StreamerChartEquityPoint>>>();
  private readonly confirmedSubscriptions: Record<StreamerServiceName, Set<string>> = {
    [STREAMER_SERVICES.LEVELONE_EQUITIES]: new Set(),
    [STREAMER_SERVICES.LEVELONE_FUTURES]: new Set(),
    [STREAMER_SERVICES.CHART_EQUITY]: new Set(),
    [STREAMER_SERVICES.ACCT_ACTIVITY]: new Set(),
  };
  private readonly confirmedFields: Record<StreamerServiceName, string | null> = {
    [STREAMER_SERVICES.LEVELONE_EQUITIES]: null,
    [STREAMER_SERVICES.LEVELONE_FUTURES]: null,
    [STREAMER_SERVICES.CHART_EQUITY]: null,
    [STREAMER_SERVICES.ACCT_ACTIVITY]: null,
  };
  private readonly lastAckAtByService: Record<StreamerServiceName, number> = {
    [STREAMER_SERVICES.LEVELONE_EQUITIES]: 0,
    [STREAMER_SERVICES.LEVELONE_FUTURES]: 0,
    [STREAMER_SERVICES.CHART_EQUITY]: 0,
    [STREAMER_SERVICES.ACCT_ACTIVITY]: 0,
  };
  private readonly serviceCommandChains: Record<StreamerServiceName, Promise<void>> = {
    [STREAMER_SERVICES.LEVELONE_EQUITIES]: Promise.resolve(),
    [STREAMER_SERVICES.LEVELONE_FUTURES]: Promise.resolve(),
    [STREAMER_SERVICES.CHART_EQUITY]: Promise.resolve(),
    [STREAMER_SERVICES.ACCT_ACTIVITY]: Promise.resolve(),
  };
  private readonly messageTimestamps: number[] = [];
  private lastBudgetPrunedAt = 0;
  private lastBudgetPrunedCount = 0;
  private lastMessageAt = 0;
  private lastHeartbeatAt = 0;
  private lastLoginAt = 0;
  private lastDisconnectAt = 0;
  private lastDisconnectReason: string | null = null;
  private reconnectAttempts = 0;
  private reconnectFailureStreak = 0;
  private lastFailureCode: number | null = null;
  private lastFailureMessage: string | null = null;
  private failurePolicy: string | null = null;
  private reconnectSuppressed = false;
  private nextReconnectAt = 0;
  private lastViewReconciliationAt = 0;
  private requestCounter = 0;
  private currentPreferences: SchwabStreamerPreferences | null = null;
  private readonly supervisionTimer: NodeJS.Timeout;

  constructor(options: SchwabStreamerSessionOptions) {
    this.logger = options.logger;
    this.websocketFactory = options.websocketFactory ?? defaultWebSocketFactory;
    this.accessTokenProvider = options.accessTokenProvider;
    this.preferencesProvider = options.preferencesProvider;
    this.equitySubscriptionFields = options.subscriptionFields ?? "0,1,2,3,8,19,20,32,34,42";
    this.futuresSubscriptionFields = options.futuresSubscriptionFields ?? "0,1,2,3,8,19,20,32,34,42";
    this.chartSubscriptionFields = "0,1,2,3,4,5,6,7";
    this.cacheSoftCap = options.cacheSoftCap ?? 500;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
    this.quoteWaitTimeoutMs = options.quoteWaitTimeoutMs ?? 750;
    this.freshnessTtlMs = options.freshnessTtlMs ?? 15_000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? Math.max(this.freshnessTtlMs * 2, 30_000);
    this.subscriptionIdleTtlMs = options.subscriptionIdleTtlMs ?? 10 * 60_000;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 1_000;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30_000;
    this.reconnectJitterMs = options.reconnectJitterMs ?? 500;
    this.viewReconciliationIntervalMs = options.viewReconciliationIntervalMs ?? 5 * 60_000;
    this.subscriptionSoftCap = options.subscriptionSoftCap ?? 250;
    this.accountActivityEnabled = options.accountActivityEnabled ?? true;
    this.stateSink = options.stateSink;
    if (this.accountActivityEnabled) {
      this.subscriptions[STREAMER_SERVICES.ACCT_ACTIVITY].set("Account Activity", {
        symbol: "Account Activity",
        lastRequestedAt: Date.now(),
        active: false,
      });
    }
    this.supervisionTimer = setInterval(() => {
      void this.runSupervisionCycle();
    }, options.supervisionIntervalMs ?? 5_000);
    this.supervisionTimer.unref?.();
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
    return this.waitForFreshData(normalized, this.quoteWaiters, () => this.getFreshQuote(normalized));
  }

  async getFuturesQuote(symbol: string): Promise<MarketDataFuturesQuote | null> {
    const normalized = this.normalizeFuturesRequestSymbol(symbol);
    if (!normalized) {
      return null;
    }
    const cached = this.getFreshFuturesQuote(normalized);
    if (cached) {
      return cached;
    }

    await this.ensureConnectedAndSubscribed([], [], [normalized]);
    return this.waitForFreshData(normalized, this.futuresWaiters, () => this.getFreshFuturesQuote(normalized));
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
    return this.waitForFreshData(normalized, this.chartWaiters, () => this.getFreshChart(normalized));
  }

  close(): void {
    clearInterval(this.supervisionTimer);
    try {
      this.ws?.close(1000, "shutdown");
    } catch {
      // ignore close races
    } finally {
      this.ws = null;
      this.connectPromise = null;
      this.loginResolve = null;
      this.loginReject = null;
      this.emitStateSnapshot();
    }
  }

  getHealth(): SchwabStreamerHealth {
    const activeSubscriptions = Object.fromEntries(
      Object.entries(this.activeSubscriptions).map(([service, symbols]) => [service, symbols.size]),
    );
    const requestedSubscriptions = Object.fromEntries(
      Object.entries(this.subscriptions).map(([service, symbols]) => [service, symbols.size]),
    );
    return {
      enabled: true,
      connected: Boolean(this.ws && this.ws.readyState === 1),
      lastMessageAt: this.lastMessageAt ? new Date(this.lastMessageAt).toISOString() : null,
      lastHeartbeatAt: this.lastHeartbeatAt ? new Date(this.lastHeartbeatAt).toISOString() : null,
      lastLoginAt: this.lastLoginAt ? new Date(this.lastLoginAt).toISOString() : null,
      lastDisconnectAt: this.lastDisconnectAt ? new Date(this.lastDisconnectAt).toISOString() : null,
      lastDisconnectReason: this.lastDisconnectReason,
      reconnectAttempts: this.reconnectAttempts,
      reconnectFailureStreak: this.reconnectFailureStreak,
      lastFailureCode: this.lastFailureCode,
      lastFailureMessage: this.lastFailureMessage,
      failurePolicy: this.failurePolicy,
      operatorState: this.currentOperatorState(),
      operatorAction: this.currentOperatorAction(),
      reconnectSuppressed: this.reconnectSuppressed,
      nextReconnectAt: this.nextReconnectAt ? new Date(this.nextReconnectAt).toISOString() : null,
      lastViewReconciliationAt: this.lastViewReconciliationAt
        ? new Date(this.lastViewReconciliationAt).toISOString()
        : null,
      activeSubscriptions,
      requestedSubscriptions,
      reconciliation: this.buildReconciliationSnapshot(),
      subscriptionBudget: this.buildBudgetSnapshot(),
      staleSymbolCount: this.countStaleSymbols(),
      messageRatePerMinute: this.currentMessageRatePerMinute(),
      stale: this.isStale(),
      recentAccountActivityEvents: this.buildRecentAccountActivitySnapshot(),
      recentFuturesQuotes: this.buildRecentFuturesSnapshot(),
    };
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

  private getFreshFuturesQuote(symbol: string): MarketDataFuturesQuote | null {
    const cached = this.futuresCache.get(symbol);
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

  private async ensureConnectedAndSubscribed(
    equitySymbols: string[],
    chartSymbols: string[],
    futuresSymbols: string[] = [],
  ): Promise<void> {
    this.touchSubscriptions(STREAMER_SERVICES.LEVELONE_EQUITIES, equitySymbols);
    this.touchSubscriptions(STREAMER_SERVICES.LEVELONE_FUTURES, futuresSymbols);
    this.touchSubscriptions(STREAMER_SERVICES.CHART_EQUITY, chartSymbols);
    await this.ensureConnected();
    await this.syncSubscriptions(STREAMER_SERVICES.LEVELONE_EQUITIES);
    await this.syncSubscriptions(STREAMER_SERVICES.LEVELONE_FUTURES);
    await this.syncSubscriptions(STREAMER_SERVICES.CHART_EQUITY);
    if (this.accountActivityEnabled) {
      await this.syncSubscriptions(STREAMER_SERVICES.ACCT_ACTIVITY);
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.reconnectSuppressed) {
      throw new Error(`Schwab streamer reconnect suppressed (${this.failurePolicy ?? "unknown policy"})`);
    }
    if (this.ws && this.ws.readyState === 1 && !this.isStale()) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    if (this.nextReconnectAt > Date.now()) {
      await sleep(this.nextReconnectAt - Date.now());
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
    this.lastHeartbeatAt = 0;

    await new Promise<void>((resolve, reject) => {
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

    ws.onmessage = (event) => this.handleMessage(event.data);
    ws.onerror = (event) => {
      this.logger.error("schwab streamer error", event);
    };
    ws.onclose = (event) => {
      this.handleClose(event.code, event.reason);
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
  }): string {
    if (!this.ws || this.ws.readyState !== 1 || !this.currentPreferences) {
      throw new Error("Schwab streamer is not connected");
    }
    this.requestCounter += 1;
    const requestId = String(this.requestCounter);
    if (input.service !== "ADMIN") {
      this.pendingRequests.set(requestId, {
        requestId,
        service: input.service,
        command: input.command,
        symbols: (input.parameters.keys ?? "")
          .split(",")
          .map((value) => value.trim().toUpperCase())
          .filter(Boolean),
        fields: input.parameters.fields ?? null,
        requestedAt: Date.now(),
      });
    }
    const payload = {
      requests: [
        {
          requestid: requestId,
          service: input.service,
          command: input.command,
          SchwabClientCustomerId: this.currentPreferences.schwabClientCustomerId,
          SchwabClientCorrelId: this.currentPreferences.schwabClientCorrelId,
          parameters: input.parameters,
        },
      ],
    };
    this.ws.send(JSON.stringify(payload));
    return requestId;
  }

  private handleMessage(raw: string): void {
    const now = Date.now();
    this.lastMessageAt = now;
    this.recordMessageActivity(now);

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
        this.lastLoginAt = now;
        this.reconnectAttempts = 0;
        this.reconnectFailureStreak = 0;
        this.lastFailureCode = null;
        this.lastFailureMessage = null;
        this.failurePolicy = null;
        this.reconnectSuppressed = false;
        this.nextReconnectAt = 0;
        this.loginResolve?.();
        this.loginResolve = null;
        this.loginReject = null;
      } else {
        this.loginReject?.(new Error(`Schwab streamer login failed: ${content.msg ?? "unknown error"}`));
        this.loginResolve = null;
        this.loginReject = null;
      }
    }

    for (const response of responses) {
      const entry = response as Record<string, unknown>;
      const content = (entry.content ?? {}) as StreamerResponseContent;
      const code = Number(content.code ?? -1);
      const requestId = String(entry.requestid ?? "");
      const pending = requestId ? this.pendingRequests.get(requestId) : undefined;
      if (this.isSuccessfulResponseCode(code)) {
        if (requestId) {
          if (pending) {
            this.applyAcknowledgedRequest(pending, now);
            this.pendingRequests.delete(requestId);
          }
          this.resolvePendingAck(requestId);
        }
        continue;
      }
      if (requestId) {
        this.pendingRequests.delete(requestId);
        this.rejectPendingAck(requestId, new Error(`Schwab streamer request failed (${code}): ${String(content.msg ?? "")}`));
      }
      this.lastFailureCode = code;
      this.lastFailureMessage = String(content.msg ?? "");
      if (code === 3) {
        this.lastDisconnectReason = `LOGIN_DENIED:${this.lastFailureMessage}`;
        this.failurePolicy = "manual_reauth_required";
        this.reconnectSuppressed = true;
        this.nextReconnectAt = 0;
      } else if (code === 12) {
        this.failurePolicy = "max_connections_exceeded";
        this.reconnectSuppressed = true;
        this.nextReconnectAt = 0;
        this.forceReconnect("CLOSE_CONNECTION");
      } else if (code === 19) {
        this.failurePolicy = "symbol_limit_reached";
        if (pending) {
          void this.handleSymbolLimitFailure(pending).catch((error) => {
            this.logger.error("Unable to reconcile subscriptions after Schwab symbol limit failure", error);
          });
        }
      } else if (code === 20) {
        this.failurePolicy = "immediate_reconnect";
        this.reconnectSuppressed = false;
        this.nextReconnectAt = Date.now();
        this.forceReconnect("STREAM_CONN_NOT_FOUND");
      } else if (code === 30) {
        this.failurePolicy = "streaming_stopped_until_reset";
        this.reconnectSuppressed = true;
        this.nextReconnectAt = 0;
        this.forceReconnect("STOP_STREAMING");
      } else {
        this.failurePolicy = "retry_backoff";
      }
    }

    const dataEntries = Array.isArray(payload.data) ? payload.data : [];
    for (const item of dataEntries) {
      const entry = item as Record<string, unknown>;
      const content = Array.isArray(entry.content) ? entry.content : [];
      const service = String(entry.service ?? "");
      if (service === STREAMER_SERVICES.LEVELONE_EQUITIES) {
        for (const row of content) {
          const normalized = normalizeStreamerEquityQuote(row as Record<string, unknown>, Number(entry.timestamp ?? now));
          if (normalized) {
            this.storeQuote(normalized, now);
            this.resolveDataWaiters(this.quoteWaiters, normalized.symbol, normalized);
          }
        }
      } else if (service === STREAMER_SERVICES.LEVELONE_FUTURES) {
        for (const row of content) {
          const normalized = normalizeStreamerFuturesQuote(row as Record<string, unknown>, Number(entry.timestamp ?? now));
          if (normalized) {
            this.storeFuturesQuote(normalized, now);
            this.resolveDataWaiters(this.futuresWaiters, normalized.symbol, normalized);
          }
        }
      } else if (service === STREAMER_SERVICES.CHART_EQUITY) {
        for (const row of content) {
          const normalized = normalizeStreamerChartEquity(row as Record<string, unknown>);
          if (normalized) {
            this.storeChart(normalized, now);
            this.resolveDataWaiters(this.chartWaiters, normalized.symbol, normalized);
          }
        }
      } else if (service === STREAMER_SERVICES.ACCT_ACTIVITY) {
        for (const row of content) {
          const normalized = normalizeStreamerAccountActivityEvent(row as Record<string, unknown>, Number(entry.timestamp ?? now));
          if (normalized) {
            this.storeAccountActivity(normalized, now);
          }
        }
      }
    }

    const notifications = Array.isArray(payload.notify) ? payload.notify : [];
    if (notifications.length) {
      this.lastHeartbeatAt = firstHeartbeat(notifications[0] as Record<string, unknown>) ?? now;
    }
    this.emitStateSnapshot();
  }

  private async runSupervisionCycle(): Promise<void> {
    this.pruneIdleSubscriptions();
    this.evictStaleCaches();
    if (!this.hasRequestedSubscriptions()) {
      return;
    }
    if (this.ws && this.ws.readyState === 1 && this.isStale()) {
      this.logger.error("schwab streamer stale; forcing reconnect", { lastMessageAt: this.lastMessageAt });
      this.forceReconnect("stale stream");
      return;
    }
    if (!this.ws && !this.connectPromise && this.nextReconnectAt === 0) {
      try {
        await this.ensureConnected();
        await this.syncSubscriptions(STREAMER_SERVICES.LEVELONE_EQUITIES);
        await this.syncSubscriptions(STREAMER_SERVICES.LEVELONE_FUTURES);
        await this.syncSubscriptions(STREAMER_SERVICES.CHART_EQUITY);
        if (this.accountActivityEnabled) {
          await this.syncSubscriptions(STREAMER_SERVICES.ACCT_ACTIVITY);
        }
      } catch (error) {
        this.logger.error("schwab streamer initial connect failed", error);
      }
      return;
    }
    if (!this.ws && this.nextReconnectAt > 0 && Date.now() >= this.nextReconnectAt && !this.connectPromise) {
      try {
        await this.ensureConnected();
        await this.syncSubscriptions(STREAMER_SERVICES.LEVELONE_EQUITIES);
        await this.syncSubscriptions(STREAMER_SERVICES.LEVELONE_FUTURES);
        await this.syncSubscriptions(STREAMER_SERVICES.CHART_EQUITY);
        if (this.accountActivityEnabled) {
          await this.syncSubscriptions(STREAMER_SERVICES.ACCT_ACTIVITY);
        }
      } catch (error) {
        this.logger.error("schwab streamer reconnect failed", error);
      }
    }
    if (this.ws && this.ws.readyState === 1 && Date.now() - this.lastViewReconciliationAt >= this.viewReconciliationIntervalMs) {
      await this.reconcileSubscriptionViews();
    }
  }

  private touchSubscriptions(service: StreamerServiceName, symbols: string[]): void {
    const registry = this.subscriptions[service];
    const now = Date.now();
    for (const symbol of symbols.map((value) => value.trim().toUpperCase()).filter(Boolean)) {
      const existing = registry.get(symbol);
      if (existing) {
        existing.lastRequestedAt = now;
        continue;
      }
      registry.set(symbol, {
        symbol,
        lastRequestedAt: now,
        active: false,
      });
    }
    this.pruneToBudget(service);
  }

  private async syncSubscriptions(service: StreamerServiceName): Promise<void> {
    const registry = this.subscriptions[service];
    const active = this.activeSubscriptions[service];
    const wantedSymbols = [...registry.keys()];
    if (!wantedSymbols.length) {
      if (active.size) {
        await this.sendSubscriptionCommand(service, "UNSUBS", [...active]);
        active.clear();
        this.emitStateSnapshot();
      }
      return;
    }
    if (service === STREAMER_SERVICES.ACCT_ACTIVITY) {
      const keys = wantedSymbols[0];
      if (!active.size) {
        await this.sendSubscriptionCommand(service, "SUBS", [keys]);
        active.add(keys);
      }
      return;
    }
    if (!active.size) {
      await this.sendSubscriptionCommand(service, "SUBS", wantedSymbols);
      wantedSymbols.forEach((symbol) => active.add(symbol));
      for (const entry of registry.values()) {
        entry.active = true;
      }
      this.emitStateSnapshot();
      return;
    }

    const additions = wantedSymbols.filter((symbol) => !active.has(symbol));
    const removals = [...active].filter((symbol) => !registry.has(symbol));
    if (!additions.length && !removals.length) {
      return;
    }
    if (additions.length) {
      await this.sendSubscriptionCommand(service, "ADD", additions);
      additions.forEach((symbol) => active.add(symbol));
    }
    if (removals.length) {
      await this.sendSubscriptionCommand(service, "UNSUBS", removals);
      removals.forEach((symbol) => active.delete(symbol));
    }
    for (const [symbol, entry] of registry.entries()) {
      entry.active = active.has(symbol);
    }
    this.emitStateSnapshot();
  }

  private async sendSubscriptionCommand(
    service: StreamerServiceName,
    command: "SUBS" | "ADD" | "UNSUBS",
    symbols: string[],
  ): Promise<void> {
    if (!symbols.length) {
      return;
    }
    const fields =
      service === STREAMER_SERVICES.LEVELONE_EQUITIES
        ? this.equitySubscriptionFields
        : service === STREAMER_SERVICES.LEVELONE_FUTURES
          ? this.futuresSubscriptionFields
        : service === STREAMER_SERVICES.CHART_EQUITY
          ? this.chartSubscriptionFields
          : "0";
    const chunkSize = this.subscriptionChunkSize();
    const chunks = chunkSymbols(symbols, chunkSize);
    if (command === "SUBS") {
      const [firstChunk, ...remaining] = chunks;
      if (firstChunk?.length) {
        await this.queueServiceMutation(service, "SUBS", {
          keys: firstChunk.join(","),
          fields,
        });
      }
      for (const chunk of remaining) {
        await this.queueServiceMutation(service, "ADD", {
          keys: chunk.join(","),
          fields,
        });
      }
      return;
    }
    for (const chunk of chunks) {
      await this.queueServiceMutation(service, command, {
        keys: chunk.join(","),
        fields,
      });
    }
  }

  private pruneIdleSubscriptions(): void {
    const now = Date.now();
    for (const service of Object.values(STREAMER_SERVICES)) {
      const registry = this.subscriptions[service];
      const active = this.activeSubscriptions[service];
      const removed: string[] = [];
      for (const [symbol, entry] of registry.entries()) {
        if (now - entry.lastRequestedAt <= this.subscriptionIdleTtlMs) {
          continue;
        }
        registry.delete(symbol);
        removed.push(symbol);
      }
      if (removed.length && this.ws && this.ws.readyState === 1) {
        const activeRemoved = removed.filter((symbol) => active.has(symbol));
        if (activeRemoved.length) {
          void this.sendSubscriptionCommand(service, "UNSUBS", activeRemoved);
          activeRemoved.forEach((symbol) => active.delete(symbol));
          this.emitStateSnapshot();
        }
      } else if (removed.length) {
        removed.forEach((symbol) => active.delete(symbol));
        this.emitStateSnapshot();
      }
    }
  }

  private hasRequestedSubscriptions(): boolean {
    return Object.values(this.subscriptions).some((registry) => registry.size > 0);
  }

  private isStale(): boolean {
    const referenceTimestamp = Math.max(this.lastHeartbeatAt, this.lastMessageAt);
    if (!referenceTimestamp) {
      return false;
    }
    return Date.now() - referenceTimestamp > this.heartbeatTimeoutMs;
  }

  private forceReconnect(reason: string): void {
    try {
      this.ws?.close(1012, reason);
    } catch {
      // ignore close races
    }
    this.handleClose(1012, reason);
  }

  private handleClose(code?: number, reason?: string): void {
    this.logger.error("schwab streamer closed", { code, reason });
    this.ws = null;
    this.loginResolve = null;
    this.loginReject = null;
    this.lastDisconnectAt = Date.now();
    this.lastDisconnectReason = `${code ?? "unknown"}:${reason ?? "no reason"}`;
    for (const [requestId, pending] of this.pendingAcks.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Schwab streamer closed before ack (${requestId})`));
      this.pendingAcks.delete(requestId);
    }
    this.resolveAllDataWaiters(this.quoteWaiters);
    this.resolveAllDataWaiters(this.futuresWaiters);
    this.resolveAllDataWaiters(this.chartWaiters);
    this.pendingRequests.clear();
    for (const active of Object.values(this.activeSubscriptions)) {
      active.clear();
    }
    if (this.hasRequestedSubscriptions() && !this.reconnectSuppressed) {
      this.reconnectAttempts += 1;
      this.reconnectFailureStreak += 1;
      const backoff = Math.min(
        this.reconnectBaseDelayMs * 2 ** Math.max(this.reconnectAttempts - 1, 0),
        this.reconnectMaxDelayMs,
      );
      const jitter = this.reconnectJitterMs > 0 ? Math.floor(Math.random() * (this.reconnectJitterMs + 1)) : 0;
      this.nextReconnectAt = Date.now() + backoff + jitter;
    } else {
      this.nextReconnectAt = 0;
    }
    this.emitStateSnapshot();
  }

  private recordMessageActivity(timestamp: number): void {
    this.messageTimestamps.push(timestamp);
    const cutoff = timestamp - 60_000;
    while (this.messageTimestamps.length && this.messageTimestamps[0] < cutoff) {
      this.messageTimestamps.shift();
    }
  }

  private currentMessageRatePerMinute(): number {
    const now = Date.now();
    const cutoff = now - 60_000;
    while (this.messageTimestamps.length && this.messageTimestamps[0] < cutoff) {
      this.messageTimestamps.shift();
    }
    return this.messageTimestamps.length;
  }

  private countStaleSymbols(): number {
    const now = Date.now();
    let stale = 0;
    for (const value of this.quoteCache.values()) {
      if (now - value.receivedAt > this.freshnessTtlMs) {
        stale += 1;
      }
    }
    for (const value of this.futuresCache.values()) {
      if (now - value.receivedAt > this.freshnessTtlMs) {
        stale += 1;
      }
    }
    for (const value of this.chartCache.values()) {
      if (now - value.receivedAt > this.freshnessTtlMs) {
        stale += 1;
      }
    }
    return stale;
  }

  private storeQuote(quote: MarketDataQuote, receivedAt: number): void {
    this.quoteCache.delete(quote.symbol);
    this.quoteCache.set(quote.symbol, { quote, receivedAt });
    this.evictOverflow(this.quoteCache);
  }

  private storeFuturesQuote(quote: MarketDataFuturesQuote, receivedAt: number): void {
    this.futuresCache.delete(quote.symbol);
    this.futuresCache.set(quote.symbol, { quote, receivedAt });
    this.evictOverflow(this.futuresCache);
  }

  private storeChart(point: StreamerChartEquityPoint, receivedAt: number): void {
    this.chartCache.delete(point.symbol);
    this.chartCache.set(point.symbol, { point, receivedAt });
    this.evictOverflow(this.chartCache);
  }

  private storeAccountActivity(event: SchwabAccountActivityEvent, receivedAt: number): void {
    this.accountActivityEvents.push({ event, receivedAt });
    while (this.accountActivityEvents.length > ACCOUNT_ACTIVITY_EVENT_BUFFER_LIMIT) {
      this.accountActivityEvents.shift();
    }
  }

  private evictOverflow<T>(cache: Map<string, T>): void {
    while (cache.size > this.cacheSoftCap) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) {
        return;
      }
      cache.delete(oldestKey);
    }
  }

  private evictStaleCaches(): void {
    const now = Date.now();
    const maxAgeMs = this.freshnessTtlMs * 2;
    for (const [symbol, cached] of this.quoteCache.entries()) {
      if (now - cached.receivedAt > maxAgeMs) {
        this.quoteCache.delete(symbol);
      }
    }
    for (const [symbol, cached] of this.futuresCache.entries()) {
      if (now - cached.receivedAt > maxAgeMs) {
        this.futuresCache.delete(symbol);
      }
    }
    for (const [symbol, cached] of this.chartCache.entries()) {
      if (now - cached.receivedAt > maxAgeMs) {
        this.chartCache.delete(symbol);
      }
    }
  }

  private emitStateSnapshot(): void {
    if (!this.stateSink) {
      return;
    }
    const quotes = Object.fromEntries(
      [...this.quoteCache.entries()].map(([symbol, cached]) => [
        symbol,
        {
          quote: cached.quote,
          receivedAt: new Date(cached.receivedAt).toISOString(),
        },
      ]),
    );
    const futuresQuotes = Object.fromEntries(
      [...this.futuresCache.entries()].map(([symbol, cached]) => [
        symbol,
        {
          quote: cached.quote,
          receivedAt: new Date(cached.receivedAt).toISOString(),
        },
      ]),
    );
    const charts = Object.fromEntries(
      [...this.chartCache.entries()].map(([symbol, cached]) => [
        symbol,
        {
          point: cached.point,
          receivedAt: new Date(cached.receivedAt).toISOString(),
        },
      ]),
    );
    const recentAccountActivityEvents = this.accountActivityEvents.map((cached) => ({
      event: cached.event,
      receivedAt: new Date(cached.receivedAt).toISOString(),
    }));
    this.stateSink({
      updatedAt: new Date().toISOString(),
      health: this.getHealth(),
      quotes,
      futuresQuotes,
      charts,
      recentAccountActivityEvents,
    });
  }

  private async reconcileSubscriptionViews(): Promise<void> {
    for (const service of Object.values(STREAMER_SERVICES)) {
      if (service === STREAMER_SERVICES.ACCT_ACTIVITY) {
        continue;
      }
      const hasActive = this.activeSubscriptions[service].size > 0;
      if (!hasActive) {
        continue;
      }
      await this.queueServiceMutation(service, "VIEW", {
        fields:
          service === STREAMER_SERVICES.LEVELONE_EQUITIES
            ? this.equitySubscriptionFields
            : service === STREAMER_SERVICES.LEVELONE_FUTURES
              ? this.futuresSubscriptionFields
              : this.chartSubscriptionFields,
      });
    }
    this.lastViewReconciliationAt = Date.now();
    this.emitStateSnapshot();
  }

  private applyAcknowledgedRequest(pending: PendingRequestMeta, timestamp: number): void {
    const service = pending.service as StreamerServiceName;
    if (!(service in this.confirmedSubscriptions)) {
      return;
    }
    this.lastAckAtByService[service] = timestamp;
    if (pending.command === "SUBS") {
      this.confirmedSubscriptions[service] = new Set(pending.symbols);
      return;
    }
    if (pending.command === "ADD") {
      pending.symbols.forEach((symbol) => this.confirmedSubscriptions[service].add(symbol));
      return;
    }
    if (pending.command === "UNSUBS") {
      pending.symbols.forEach((symbol) => this.confirmedSubscriptions[service].delete(symbol));
      return;
    }
    if (pending.command === "VIEW") {
      this.confirmedFields[service] = pending.fields;
    }
  }

  private buildReconciliationSnapshot(): Record<string, StreamerServiceReconciliation> {
    const out: Record<string, StreamerServiceReconciliation> = {} as Record<string, StreamerServiceReconciliation>;
    for (const service of Object.values(STREAMER_SERVICES)) {
      const intended = this.subscriptions[service];
      const active = this.activeSubscriptions[service];
      const confirmed = this.confirmedSubscriptions[service];
      const requestedFields =
        service === STREAMER_SERVICES.LEVELONE_EQUITIES
          ? this.equitySubscriptionFields
          : service === STREAMER_SERVICES.LEVELONE_FUTURES
            ? this.futuresSubscriptionFields
          : service === STREAMER_SERVICES.CHART_EQUITY
            ? this.chartSubscriptionFields
            : "0";
      const symbolDriftCount =
        [...intended.keys()].filter((symbol) => !confirmed.has(symbol)).length +
        [...confirmed].filter((symbol) => !intended.has(symbol)).length;
      out[service] = {
        intendedSymbols: intended.size,
        activeSymbols: active.size,
        confirmedSymbols: confirmed.size,
        symbolDriftCount,
        requestedFields,
        confirmedFields: this.confirmedFields[service],
        fieldsMatch: !this.confirmedFields[service] || this.confirmedFields[service] === requestedFields,
        lastAckAt: this.lastAckAtByService[service] ? new Date(this.lastAckAtByService[service]).toISOString() : null,
      };
    }
    return out;
  }

  private buildBudgetSnapshot(): Record<string, StreamerServiceBudget> {
    const out: Record<string, StreamerServiceBudget> = {} as Record<string, StreamerServiceBudget>;
    for (const service of Object.values(STREAMER_SERVICES)) {
      const requestedSymbols = this.subscriptions[service].size;
      const softCap = service === STREAMER_SERVICES.ACCT_ACTIVITY ? 1 : this.subscriptionSoftCap;
      out[service] = {
        requestedSymbols,
        softCap,
        headroomRemaining: Math.max(softCap - requestedSymbols, 0),
        overSoftCap: requestedSymbols > softCap,
        lastPrunedAt: this.lastBudgetPrunedAt ? new Date(this.lastBudgetPrunedAt).toISOString() : null,
        lastPrunedCount: this.lastBudgetPrunedCount,
      };
    }
    return out;
  }

  private buildRecentAccountActivitySnapshot(): SchwabAccountActivityEvent[] {
    return this.accountActivityEvents.map((cached) => cached.event);
  }

  private buildRecentFuturesSnapshot(): MarketDataFuturesQuote[] {
    return [...this.futuresCache.values()].map((cached) => cached.quote);
  }

  private subscriptionChunkSize(): number {
    return Math.max(1, Math.min(this.subscriptionSoftCap, 50));
  }

  private pruneToBudget(service: StreamerServiceName): void {
    if (service === STREAMER_SERVICES.ACCT_ACTIVITY) {
      return;
    }
    const registry = this.subscriptions[service];
    if (registry.size <= this.subscriptionSoftCap) {
      return;
    }
    const ordered = [...registry.values()].sort((left, right) => left.lastRequestedAt - right.lastRequestedAt);
    const removeCount = registry.size - this.subscriptionSoftCap;
    const toRemove = ordered.slice(0, removeCount);
    for (const entry of toRemove) {
      registry.delete(entry.symbol);
    }
    this.lastBudgetPrunedAt = Date.now();
    this.lastBudgetPrunedCount = toRemove.length;
  }

  private async handleSymbolLimitFailure(pending: PendingRequestMeta): Promise<void> {
    const service = pending.service as StreamerServiceName;
    if (!(service in this.subscriptions)) {
      return;
    }
    this.pruneToBudget(service);
    const registry = this.subscriptions[service];
    const allowed = new Set([...registry.keys()]);
    let changed = false;
    for (const symbol of pending.symbols) {
      if (!allowed.has(symbol) && this.confirmedSubscriptions[service].has(symbol)) {
        this.confirmedSubscriptions[service].delete(symbol);
        changed = true;
      }
    }
    if (changed) {
      this.emitStateSnapshot();
    }
    if (this.ws && this.ws.readyState === 1) {
      await this.syncSubscriptions(service);
    }
  }

  private currentOperatorState(): string {
    if (this.failurePolicy === "manual_reauth_required") {
      return "human_action_required";
    }
    if (this.failurePolicy === "max_connections_exceeded") {
      return "max_connections_blocked";
    }
    if (this.failurePolicy === "streaming_stopped_until_reset") {
      return "streaming_paused";
    }
    if (this.failurePolicy === "immediate_reconnect") {
      return "session_drift_reconnect";
    }
    if (this.failurePolicy === "symbol_limit_reached") {
      return "subscription_budget_exceeded";
    }
    if (this.failurePolicy === "retry_backoff") {
      return "retrying";
    }
    return "healthy";
  }

  private currentOperatorAction(): string {
    if (this.failurePolicy === "manual_reauth_required") {
      return "Re-authenticate Schwab credentials and refresh the access token before retrying the stream.";
    }
    if (this.failurePolicy === "max_connections_exceeded") {
      return "Another Schwab stream is already using the user session. Demote this instance or stop the competing connection.";
    }
    if (this.failurePolicy === "streaming_stopped_until_reset") {
      return "Streaming was stopped by Schwab due to inactivity or slowness. Verify subscriptions and re-enable the leader session.";
    }
    if (this.failurePolicy === "immediate_reconnect") {
      return "Session drift detected. Reconnect immediately and verify Schwab customer/correlation identifiers remain stable.";
    }
    if (this.failurePolicy === "symbol_limit_reached") {
      return "Requested subscriptions exceeded the Schwab symbol budget. Prune the registry or raise the soft cap only if justified.";
    }
    if (this.failurePolicy === "retry_backoff") {
      return "A streamer command failed. Let the session retry with backoff and inspect request sequencing if the problem repeats.";
    }
    return "No operator action required.";
  }

  private isSuccessfulResponseCode(code: number): boolean {
    return code <= 0 || code === 26 || code === 27 || code === 28 || code === 29;
  }

  private async queueServiceMutation(
    service: StreamerServiceName,
    command: "SUBS" | "ADD" | "UNSUBS" | "VIEW",
    parameters: Record<string, string>,
  ): Promise<void> {
    const previous = this.serviceCommandChains[service];
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const requestId = this.sendRequest({ service, command, parameters });
        await this.waitForAck(requestId);
      });
    this.serviceCommandChains[service] = next;
    await next;
  }

  private waitForAck(requestId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAcks.delete(requestId);
        reject(new Error(`Schwab streamer request timed out waiting for ack (${requestId})`));
      }, this.connectTimeoutMs);
      this.pendingAcks.set(requestId, { resolve, reject, timeout });
    });
  }

  private resolvePendingAck(requestId: string): void {
    const pending = this.pendingAcks.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingAcks.delete(requestId);
    pending.resolve();
  }

  private rejectPendingAck(requestId: string, error: Error): void {
    const pending = this.pendingAcks.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingAcks.delete(requestId);
    pending.reject(error);
  }

  private waitForFreshData<T>(
    symbol: string,
    waiterMap: Map<string, Set<PendingDataWaiter<T>>>,
    readFresh: () => T | null,
  ): Promise<T | null> {
    const immediate = readFresh();
    if (immediate) {
      return Promise.resolve(immediate);
    }

    return new Promise<T | null>((resolve) => {
      const waiter: PendingDataWaiter<T> = {
        resolve: (value) => {
          clearTimeout(waiter.timeout);
          resolve(value ?? readFresh());
        },
        timeout: setTimeout(() => {
          const waiters = waiterMap.get(symbol);
          if (waiters) {
            waiters.delete(waiter);
            if (!waiters.size) {
              waiterMap.delete(symbol);
            }
          }
          resolve(readFresh());
        }, this.quoteWaitTimeoutMs),
      };
      const waiters = waiterMap.get(symbol) ?? new Set<PendingDataWaiter<T>>();
      waiters.add(waiter);
      waiterMap.set(symbol, waiters);
    });
  }

  private resolveDataWaiters<T>(
    waiterMap: Map<string, Set<PendingDataWaiter<T>>>,
    symbol: string,
    value: T,
  ): void {
    const waiters = waiterMap.get(symbol);
    if (!waiters?.size) {
      return;
    }
    waiterMap.delete(symbol);
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve(value);
    }
  }

  private resolveAllDataWaiters<T>(waiterMap: Map<string, Set<PendingDataWaiter<T>>>): void {
    for (const [symbol, waiters] of waiterMap.entries()) {
      waiterMap.delete(symbol);
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout);
        waiter.resolve(null);
      }
    }
  }

  private normalizeFuturesRequestSymbol(symbol: string): string | null {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) {
      return null;
    }
    const prefixed = normalized.startsWith("/") ? normalized : `/${normalized}`;
    return isSupportedFuturesSymbol(prefixed) ? prefixed : null;
  }
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

function firstHeartbeat(entry: Record<string, unknown>): number | undefined {
  const value = entry.heartbeat;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function chunkSymbols(symbols: string[], chunkSize: number): string[][] {
  const out: string[][] = [];
  for (let index = 0; index < symbols.length; index += chunkSize) {
    out.push(symbols.slice(index, index + chunkSize));
  }
  return out;
}
