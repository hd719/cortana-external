import type { AppLogger } from "../lib/logger.js";
import type { MarketDataQuote } from "./types.js";
import {
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
  connectTimeoutMs?: number;
  quoteWaitTimeoutMs?: number;
  freshnessTtlMs?: number;
  heartbeatTimeoutMs?: number;
  subscriptionIdleTtlMs?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  viewReconciliationIntervalMs?: number;
  supervisionIntervalMs?: number;
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

interface SubscriptionEntry {
  symbol: string;
  lastRequestedAt: number;
  active: boolean;
}

interface PendingRequestMeta {
  service: string;
  command: string;
  symbols: string[];
  fields: string | null;
  requestedAt: number;
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

interface SharedCachedQuote {
  quote: MarketDataQuote;
  receivedAt: string;
}

interface SharedCachedChartPoint {
  point: StreamerChartEquityPoint;
  receivedAt: string;
}

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
  reconnectSuppressed: boolean;
  nextReconnectAt: string | null;
  lastViewReconciliationAt: string | null;
  activeSubscriptions: Record<string, number>;
  requestedSubscriptions: Record<string, number>;
  reconciliation: Record<string, StreamerServiceReconciliation>;
  staleSymbolCount: number;
  messageRatePerMinute: number;
  stale: boolean;
}

export interface SharedStreamerState {
  updatedAt: string;
  health: SchwabStreamerHealth;
  quotes: Record<string, SharedCachedQuote>;
  charts: Record<string, SharedCachedChartPoint>;
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
  private readonly heartbeatTimeoutMs: number;
  private readonly subscriptionIdleTtlMs: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly viewReconciliationIntervalMs: number;
  private readonly stateSink?: (state: SharedStreamerState) => void;
  private ws: WebSocketLike | null = null;
  private connectPromise: Promise<void> | null = null;
  private loginResolve: (() => void) | null = null;
  private loginReject: ((error: Error) => void) | null = null;
  private readonly subscriptions: Record<StreamerServiceName, Map<string, SubscriptionEntry>> = {
    [STREAMER_SERVICES.LEVELONE_EQUITIES]: new Map(),
    [STREAMER_SERVICES.CHART_EQUITY]: new Map(),
  };
  private readonly activeSubscriptions: Record<StreamerServiceName, Set<string>> = {
    [STREAMER_SERVICES.LEVELONE_EQUITIES]: new Set(),
    [STREAMER_SERVICES.CHART_EQUITY]: new Set(),
  };
  private readonly quoteCache = new Map<string, CachedQuote>();
  private readonly chartCache = new Map<string, CachedChartPoint>();
  private readonly pendingRequests = new Map<string, PendingRequestMeta>();
  private readonly confirmedSubscriptions: Record<StreamerServiceName, Set<string>> = {
    [STREAMER_SERVICES.LEVELONE_EQUITIES]: new Set(),
    [STREAMER_SERVICES.CHART_EQUITY]: new Set(),
  };
  private readonly confirmedFields: Record<StreamerServiceName, string | null> = {
    [STREAMER_SERVICES.LEVELONE_EQUITIES]: null,
    [STREAMER_SERVICES.CHART_EQUITY]: null,
  };
  private readonly lastAckAtByService: Record<StreamerServiceName, number> = {
    [STREAMER_SERVICES.LEVELONE_EQUITIES]: 0,
    [STREAMER_SERVICES.CHART_EQUITY]: 0,
  };
  private readonly messageTimestamps: number[] = [];
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
    this.equitySubscriptionFields = options.subscriptionFields ?? "0,1,2,3,34";
    this.chartSubscriptionFields = "0,1,2,3,4,5,6,7";
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
    this.quoteWaitTimeoutMs = options.quoteWaitTimeoutMs ?? 750;
    this.freshnessTtlMs = options.freshnessTtlMs ?? 15_000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? Math.max(this.freshnessTtlMs * 2, 30_000);
    this.subscriptionIdleTtlMs = options.subscriptionIdleTtlMs ?? 10 * 60_000;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 1_000;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30_000;
    this.viewReconciliationIntervalMs = options.viewReconciliationIntervalMs ?? 5 * 60_000;
    this.stateSink = options.stateSink;
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
      reconnectSuppressed: this.reconnectSuppressed,
      nextReconnectAt: this.nextReconnectAt ? new Date(this.nextReconnectAt).toISOString() : null,
      lastViewReconciliationAt: this.lastViewReconciliationAt
        ? new Date(this.lastViewReconciliationAt).toISOString()
        : null,
      activeSubscriptions,
      requestedSubscriptions,
      reconciliation: this.buildReconciliationSnapshot(),
      staleSymbolCount: this.countStaleSymbols(),
      messageRatePerMinute: this.currentMessageRatePerMinute(),
      stale: this.isStale(),
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
    this.touchSubscriptions(STREAMER_SERVICES.LEVELONE_EQUITIES, equitySymbols);
    this.touchSubscriptions(STREAMER_SERVICES.CHART_EQUITY, chartSymbols);
    await this.ensureConnected();
    this.syncSubscriptions(STREAMER_SERVICES.LEVELONE_EQUITIES);
    this.syncSubscriptions(STREAMER_SERVICES.CHART_EQUITY);
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
  }): void {
    if (!this.ws || this.ws.readyState !== 1 || !this.currentPreferences) {
      throw new Error("Schwab streamer is not connected");
    }
    this.requestCounter += 1;
    const requestId = String(this.requestCounter);
    if (input.service !== "ADMIN") {
      this.pendingRequests.set(requestId, {
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
      if (code <= 0) {
        if (requestId) {
          const pending = this.pendingRequests.get(requestId);
          if (pending) {
            this.applyAcknowledgedRequest(pending, now);
            this.pendingRequests.delete(requestId);
          }
        }
        continue;
      }
      if (requestId) {
        this.pendingRequests.delete(requestId);
      }
      this.lastFailureCode = code;
      this.lastFailureMessage = String(content.msg ?? "");
      if (code === 3) {
        this.lastDisconnectReason = `LOGIN_DENIED:${this.lastFailureMessage}`;
        this.failurePolicy = "manual_reauth_required";
        this.reconnectSuppressed = true;
        this.nextReconnectAt = 0;
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
            this.quoteCache.set(normalized.symbol, { quote: normalized, receivedAt: now });
          }
        }
      } else if (service === STREAMER_SERVICES.CHART_EQUITY) {
        for (const row of content) {
          const normalized = normalizeStreamerChartEquity(row as Record<string, unknown>);
          if (normalized) {
            this.chartCache.set(normalized.symbol, { point: normalized, receivedAt: now });
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
    if (!this.hasRequestedSubscriptions()) {
      return;
    }
    if (this.ws && this.ws.readyState === 1 && this.isStale()) {
      this.logger.error("schwab streamer stale; forcing reconnect", { lastMessageAt: this.lastMessageAt });
      this.forceReconnect("stale stream");
      return;
    }
    if (!this.ws && this.nextReconnectAt > 0 && Date.now() >= this.nextReconnectAt && !this.connectPromise) {
      try {
        await this.ensureConnected();
        this.syncSubscriptions(STREAMER_SERVICES.LEVELONE_EQUITIES);
        this.syncSubscriptions(STREAMER_SERVICES.CHART_EQUITY);
      } catch (error) {
        this.logger.error("schwab streamer reconnect failed", error);
      }
    }
    if (this.ws && this.ws.readyState === 1 && Date.now() - this.lastViewReconciliationAt >= this.viewReconciliationIntervalMs) {
      this.reconcileSubscriptionViews();
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
  }

  private syncSubscriptions(service: StreamerServiceName): void {
    const registry = this.subscriptions[service];
    const active = this.activeSubscriptions[service];
    const wantedSymbols = [...registry.keys()];
    if (!wantedSymbols.length) {
      if (active.size) {
        this.sendSubscriptionCommand(service, "UNSUBS", [...active]);
        active.clear();
        this.emitStateSnapshot();
      }
      return;
    }
    if (!active.size) {
      this.sendSubscriptionCommand(service, "SUBS", wantedSymbols);
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
      this.sendSubscriptionCommand(service, "ADD", additions);
      additions.forEach((symbol) => active.add(symbol));
    }
    if (removals.length) {
      this.sendSubscriptionCommand(service, "UNSUBS", removals);
      removals.forEach((symbol) => active.delete(symbol));
    }
    for (const [symbol, entry] of registry.entries()) {
      entry.active = active.has(symbol);
    }
    this.emitStateSnapshot();
  }

  private sendSubscriptionCommand(service: StreamerServiceName, command: "SUBS" | "ADD" | "UNSUBS", symbols: string[]): void {
    if (!symbols.length) {
      return;
    }
    this.sendRequest({
      service,
      command,
      parameters: {
        keys: symbols.join(","),
        fields: service === STREAMER_SERVICES.LEVELONE_EQUITIES ? this.equitySubscriptionFields : this.chartSubscriptionFields,
      },
    });
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
          this.sendSubscriptionCommand(service, "UNSUBS", activeRemoved);
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
    for (const active of Object.values(this.activeSubscriptions)) {
      active.clear();
    }
    if (this.hasRequestedSubscriptions()) {
      this.reconnectAttempts += 1;
      this.reconnectFailureStreak += 1;
      const backoff = Math.min(
        this.reconnectBaseDelayMs * 2 ** Math.max(this.reconnectAttempts - 1, 0),
        this.reconnectMaxDelayMs,
      );
      this.nextReconnectAt = Date.now() + backoff;
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
    for (const value of this.chartCache.values()) {
      if (now - value.receivedAt > this.freshnessTtlMs) {
        stale += 1;
      }
    }
    return stale;
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
    const charts = Object.fromEntries(
      [...this.chartCache.entries()].map(([symbol, cached]) => [
        symbol,
        {
          point: cached.point,
          receivedAt: new Date(cached.receivedAt).toISOString(),
        },
      ]),
    );
    this.stateSink({
      updatedAt: new Date().toISOString(),
      health: this.getHealth(),
      quotes,
      charts,
    });
  }

  private reconcileSubscriptionViews(): void {
    for (const service of Object.values(STREAMER_SERVICES)) {
      const hasActive = this.activeSubscriptions[service].size > 0;
      if (!hasActive) {
        continue;
      }
      this.sendRequest({
        service,
        command: "VIEW",
        parameters: {
          fields: service === STREAMER_SERVICES.LEVELONE_EQUITIES ? this.equitySubscriptionFields : this.chartSubscriptionFields,
        },
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
        service === STREAMER_SERVICES.LEVELONE_EQUITIES ? this.equitySubscriptionFields : this.chartSubscriptionFields;
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
