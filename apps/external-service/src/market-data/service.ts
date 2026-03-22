import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";

import type { AppConfig } from "../config.js";
import { HttpError, readJsonResponse } from "../lib/http.js";
import type { AppLogger } from "../lib/logger.js";
import { createLogger } from "../lib/logger.js";
import {
  compareHistoryRows,
  compareQuotes,
  mapAlpacaTimeframe,
  mapSchwabPeriod,
  normalizeHistoryInterval,
  normalizeHistoryProvider,
  type HistoryInterval,
  type HistoryProvider,
} from "./history-utils.js";
import {
  buildUnavailableCompare,
  marketDataErrorResponse,
  normalizeAlpacaBarLimit,
  normalizeAlpacaDataUrl,
  normalizeMarketSymbol,
  parseBatchSymbols,
  resolveQuery,
} from "./route-utils.js";
import { normalizeSchwabQuoteEnvelope, type SchwabQuoteEnvelope } from "./schwab-normalizers.js";
import {
  SchwabStreamerSession,
  type SchwabStreamerPreferences,
  type SharedStreamerState,
  type WebSocketFactory,
} from "./streamer.js";
import { UniverseArtifactManager, type UniverseAuditEntry } from "./universe-manager.js";
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
import {
  dedupe,
  parseSharedStateNotification,
  parseUniverseSourceLadder,
  readJsonFile,
} from "./universe-utils.js";

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
  websocketFactory?: WebSocketFactory;
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

interface ProviderMetrics {
  lastSuccessfulSchwabRestAt: string | null;
  lastSuccessfulYahooFallbackAt: string | null;
  lastSuccessfulUniverseRefreshAt: string | null;
  lastSharedStateNotificationAt: string | null;
  tokenRefreshInFlight: boolean;
  lastTokenRefreshAt: string | null;
  lastTokenRefreshFailureAt: string | null;
  schwabTokenStatus: "ready" | "human_action_required";
  schwabTokenReason: string | null;
  lastSchwabFailureAt: string | null;
  schwabConsecutiveFailures: number;
  schwabCooldownUntil: string | null;
  yahooConsecutiveFailures: number;
  yahooCircuitOpenUntil: string | null;
  sourceUsage: Record<string, number>;
  fallbackUsage: Record<string, number>;
}

export class MarketDataService {
  private readonly logger: AppLogger;
  private readonly fetchImpl: FetchImpl;
  private readonly config: AppConfig;
  private readonly requestTimeoutMs: number;
  private readonly cacheDir: string;
  private readonly schwabFailureThreshold: number;
  private readonly schwabCooldownMs: number;
  private readonly yahooCircuitFailureThreshold: number;
  private readonly yahooCircuitCooldownMs: number;
  private readonly universeSeedPath: string;
  private readonly universeSourceLadder: string[];
  private readonly universeRemoteJsonUrl: string;
  private readonly universeLocalJsonPath: string | null;
  private readonly schwabTokenPath: string;
  private readonly configuredStreamerRole: "auto" | "leader" | "follower" | "disabled";
  private activeStreamerRole: "leader" | "follower" | "disabled";
  private readonly streamerPgLockKey: number;
  private readonly streamerSharedStateBackend: "file" | "postgres";
  private readonly streamerSharedStatePath: string;
  private readonly streamerEnabled: boolean;
  private readonly universeManager: UniverseArtifactManager;
  private streamer: SchwabStreamerSession | null = null;
  private readonly providerMetrics: ProviderMetrics = {
    lastSuccessfulSchwabRestAt: null,
    lastSuccessfulYahooFallbackAt: null,
    lastSuccessfulUniverseRefreshAt: null,
    lastSharedStateNotificationAt: null,
    tokenRefreshInFlight: false,
    lastTokenRefreshAt: null,
    lastTokenRefreshFailureAt: null,
    schwabTokenStatus: "ready",
    schwabTokenReason: null,
    lastSchwabFailureAt: null,
    schwabConsecutiveFailures: 0,
    schwabCooldownUntil: null,
    yahooConsecutiveFailures: 0,
    yahooCircuitOpenUntil: null,
    sourceUsage: {},
    fallbackUsage: {},
  };
  private schwabCooldownUntilMs = 0;
  private yahooCircuitOpenUntilMs = 0;
  private tokenRefreshPromise: Promise<string> | null = null;
  private pool: Pool | null = null;
  private dbReadyPromise: Promise<void> | null = null;
  private leaderLockClient: PoolClient | null = null;
  private sharedStateListenerClient: PoolClient | null = null;
  private sharedStateCache: SharedStreamerState | null = null;
  private sharedStateCacheMtimeMs: number | null = null;
  private runtimeReadyPromise: Promise<void> | null = null;

  constructor(config: MarketDataServiceConfig = {}) {
    this.logger = config.logger ?? createLogger("market-data");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.config = config.config ?? ({
      PORT: 3033,
      MARKET_DATA_CACHE_DIR: ".cache/market_data",
      MARKET_DATA_REQUEST_TIMEOUT_MS: 30_000,
      MARKET_DATA_UNIVERSE_SEED_PATH: "backtester/data/universe.py",
      MARKET_DATA_UNIVERSE_SOURCE_LADDER: "python_seed",
      MARKET_DATA_UNIVERSE_REMOTE_JSON_URL: "",
      MARKET_DATA_UNIVERSE_LOCAL_JSON_PATH: "",
      MARKET_DATA_SCHWAB_FAILURE_THRESHOLD: 3,
      MARKET_DATA_SCHWAB_COOLDOWN_MS: 20_000,
      MARKET_DATA_YAHOO_CIRCUIT_FAILURE_THRESHOLD: 5,
      MARKET_DATA_YAHOO_CIRCUIT_COOLDOWN_MS: 60_000,
      SCHWAB_CLIENT_ID: "",
      SCHWAB_CLIENT_SECRET: "",
      SCHWAB_REFRESH_TOKEN: "",
      SCHWAB_TOKEN_PATH: ".cache/market_data/schwab-token.json",
      SCHWAB_API_BASE_URL: "https://api.schwabapi.com",
      SCHWAB_TOKEN_URL: "https://api.schwabapi.com/v1/oauth/token",
      SCHWAB_USER_PREFERENCES_URL: "",
      SCHWAB_STREAMER_ENABLED: "1",
      SCHWAB_STREAMER_ROLE: "leader",
      SCHWAB_STREAMER_PG_LOCK_KEY: 814021,
      SCHWAB_STREAMER_SHARED_STATE_BACKEND: "postgres",
      SCHWAB_STREAMER_SHARED_STATE_PATH: ".cache/market_data/schwab-streamer-state.json",
      SCHWAB_STREAMER_CONNECT_TIMEOUT_MS: 5_000,
      SCHWAB_STREAMER_QUOTE_TTL_MS: 15_000,
      SCHWAB_STREAMER_SYMBOL_SOFT_CAP: 250,
      SCHWAB_STREAMER_CACHE_SOFT_CAP: 500,
      SCHWAB_STREAMER_EQUITY_FIELDS: "0,1,2,3,8,19,20,32,34,42",
      SCHWAB_STREAMER_ACCOUNT_ACTIVITY_ENABLED: "1",
      SCHWAB_STREAMER_RECONNECT_JITTER_MS: 500,
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
    this.schwabFailureThreshold = this.config.MARKET_DATA_SCHWAB_FAILURE_THRESHOLD;
    this.schwabCooldownMs = this.config.MARKET_DATA_SCHWAB_COOLDOWN_MS;
    this.yahooCircuitFailureThreshold = this.config.MARKET_DATA_YAHOO_CIRCUIT_FAILURE_THRESHOLD;
    this.yahooCircuitCooldownMs = this.config.MARKET_DATA_YAHOO_CIRCUIT_COOLDOWN_MS;
    this.universeSeedPath = resolveRepoPath(this.config.MARKET_DATA_UNIVERSE_SEED_PATH);
    this.universeSourceLadder = parseUniverseSourceLadder(this.config.MARKET_DATA_UNIVERSE_SOURCE_LADDER);
    this.universeRemoteJsonUrl = this.config.MARKET_DATA_UNIVERSE_REMOTE_JSON_URL.trim();
    this.universeLocalJsonPath = resolveOptionalRepoPath(this.config.MARKET_DATA_UNIVERSE_LOCAL_JSON_PATH);
    this.schwabTokenPath = resolveRepoPath(this.config.SCHWAB_TOKEN_PATH);
    this.configuredStreamerRole = this.config.SCHWAB_STREAMER_ROLE;
    this.activeStreamerRole = this.configuredStreamerRole === "auto" ? "follower" : this.configuredStreamerRole;
    this.streamerPgLockKey = this.config.SCHWAB_STREAMER_PG_LOCK_KEY;
    this.streamerSharedStateBackend = this.config.SCHWAB_STREAMER_SHARED_STATE_BACKEND;
    this.streamerSharedStatePath = resolveRepoPath(this.config.SCHWAB_STREAMER_SHARED_STATE_PATH);
    this.streamerEnabled = !["0", "false", "no", "off"].includes(
      this.config.SCHWAB_STREAMER_ENABLED.trim().toLowerCase(),
    );
    this.universeManager = new UniverseArtifactManager({
      cacheDir: this.cacheDir,
      sourceLadder: this.universeSourceLadder,
      remoteJsonUrl: this.universeRemoteJsonUrl,
      localJsonPath: this.universeLocalJsonPath,
      seedPath: this.universeSeedPath,
      logger: this.logger,
      fetchJson: this.fetchJson.bind(this),
    });
    if (this.streamerEnabled && this.activeStreamerRole === "leader" && this.isSchwabConfigured()) {
      this.streamer = this.createStreamer(config.websocketFactory);
    }
  }

  async checkHealth(): Promise<Record<string, unknown>> {
    await this.ensureRuntimeReady();
    await this.enforceStreamerFailurePolicy();
    const sharedState = await this.readSharedStreamerState();
    const streamerHealth = this.streamer?.getHealth() ?? sharedState?.health ?? null;
    return {
      status: "healthy",
      providers: {
        schwab: this.isSchwabConfigured() ? "configured" : "disabled",
        schwabStreamer: this.streamer ? "enabled" : "disabled",
        schwabStreamerMeta: streamerHealth,
        schwabStreamerRole: this.activeStreamerRole,
        schwabStreamerRoleConfigured: this.configuredStreamerRole,
        schwabStreamerPgLockKey: this.streamerPgLockKey,
        schwabStreamerSharedStateBackend: this.streamerSharedStateBackend,
        schwabStreamerSharedStatePath: this.streamerSharedStatePath,
        schwabStreamerSharedStateUpdatedAt: sharedState?.updatedAt ?? null,
        schwabTokenStatus: this.providerMetrics.schwabTokenStatus,
        schwabTokenReason: this.providerMetrics.schwabTokenReason,
        yahoo: "ready",
        fred: this.config.FRED_API_KEY ? "configured" : "unauthenticated",
        universeSeedPath: this.universeSeedPath,
        universeSourceLadder: this.universeSourceLadder,
        universeRemoteJsonUrl: this.universeRemoteJsonUrl || null,
        universeLocalJsonPath: this.universeLocalJsonPath,
        providerMetrics: this.providerMetrics,
      },
    };
  }

  async startup(): Promise<void> {
    await this.ensureRuntimeReady();
  }

  async shutdown(): Promise<void> {
    this.streamer?.close();
    this.streamer = null;
    if (this.sharedStateListenerClient) {
      try {
        await this.sharedStateListenerClient.query("UNLISTEN market_data_streamer_state_changed");
      } catch (error) {
        this.logger.error("Unable to unlisten market-data shared state channel", error);
      } finally {
        this.sharedStateListenerClient.release();
        this.sharedStateListenerClient = null;
      }
    }
    if (this.leaderLockClient) {
      try {
        await this.leaderLockClient.query("SELECT pg_advisory_unlock($1)", [this.streamerPgLockKey]);
      } catch (error) {
        this.logger.error("Unable to release Schwab streamer advisory lock", error);
      } finally {
        this.leaderLockClient.release();
        this.leaderLockClient = null;
      }
    }
    if (this.pool) {
      await this.pool.end().catch((error) => {
        this.logger.error("Unable to close market-data pool", error);
      });
      this.pool = null;
      this.dbReadyPromise = null;
    }
  }

  async handleHistory(request: Request, rawSymbol: string, compareWith?: string): Promise<MarketDataRouteResult<MarketDataHistory>> {
    await this.ensureRuntimeReady();
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }

    const period = resolveQuery(request.url, "period", "1y");
    const rawInterval = resolveQuery(request.url, "interval", DEFAULT_INTERVAL);
    const interval = normalizeHistoryInterval(rawInterval);
    if (!interval) {
      return {
        status: 400,
        body: marketDataErrorResponse("invalid interval", "error", {
          reason: `unsupported interval '${rawInterval}'; supported intervals are 1d, 1wk, and 1mo`,
        }),
      };
    }
    const rawProvider = resolveQuery(request.url, "provider", "service");
    const provider = normalizeHistoryProvider(rawProvider);
    if (!provider) {
      return {
        status: 400,
        body: marketDataErrorResponse("invalid provider", "error", {
          reason: `unsupported provider '${rawProvider}'; supported providers are service, schwab, yahoo, and alpaca`,
        }),
      };
    }
    try {
      const primary = await this.fetchPrimaryHistory(symbol, period, interval, provider);
      this.recordSourceUsage(primary.source);
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
    await this.ensureRuntimeReady();
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }

    try {
      const primary = await this.fetchPrimaryQuote(symbol);
      this.recordSourceUsage(primary.source);
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

  async handleQuoteBatch(request: Request): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    await this.ensureRuntimeReady();
    const symbols = parseBatchSymbols(request.url);
    if (!symbols.length) {
      return { status: 400, body: marketDataErrorResponse("invalid symbols", "error", { reason: "symbols query is required" }) };
    }
    const compareWith = resolveQuery(request.url, "compare_with", "").trim() || undefined;
    const items = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const primary = await this.fetchPrimaryQuote(symbol);
          this.recordSourceUsage(primary.source);
          const compare = await this.buildQuoteComparison(symbol, compareWith, primary.quote);
          return {
            symbol,
            source: primary.source,
            status: primary.status,
            degradedReason: primary.degradedReason ?? null,
            stalenessSeconds: primary.stalenessSeconds,
            data: primary.quote,
            ...(compare ? { compare_with: compare } : {}),
          };
        } catch (error) {
          return {
            symbol,
            source: "service",
            status: "error",
            degradedReason: summarizeError(error),
            stalenessSeconds: null,
            data: { symbol },
          };
        }
      }),
    );
    return this.toBatchRouteResult(items);
  }

  async handleSnapshot(
    _request: Request,
    rawSymbol: string,
    compareWith?: string,
  ): Promise<MarketDataRouteResult<MarketDataSnapshot>> {
    await this.ensureRuntimeReady();
    const symbol = normalizeMarketSymbol(rawSymbol);
    if (!symbol) {
      return { status: 400, body: marketDataErrorResponse("invalid symbol", "error", { reason: "symbol required" }) };
    }

    try {
      const primary = await this.fetchPrimarySnapshot(symbol);
      this.recordSourceUsage(primary.source);
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

  async handleHistoryBatch(request: Request): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    await this.ensureRuntimeReady();
    const symbols = parseBatchSymbols(request.url);
    if (!symbols.length) {
      return { status: 400, body: marketDataErrorResponse("invalid symbols", "error", { reason: "symbols query is required" }) };
    }

    const period = resolveQuery(request.url, "period", "1y");
    const rawInterval = resolveQuery(request.url, "interval", DEFAULT_INTERVAL);
    const interval = normalizeHistoryInterval(rawInterval);
    if (!interval) {
      return {
        status: 400,
        body: marketDataErrorResponse("invalid interval", "error", {
          reason: `unsupported interval '${rawInterval}'; supported intervals are 1d, 1wk, and 1mo`,
        }),
      };
    }
    const rawProvider = resolveQuery(request.url, "provider", "service");
    const provider = normalizeHistoryProvider(rawProvider);
    if (!provider) {
      return {
        status: 400,
        body: marketDataErrorResponse("invalid provider", "error", {
          reason: `unsupported provider '${rawProvider}'; supported providers are service, schwab, yahoo, and alpaca`,
        }),
      };
    }
    const compareWith = resolveQuery(request.url, "compare_with", "").trim() || undefined;
    const items = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const primary = await this.fetchPrimaryHistory(symbol, period, interval, provider);
          this.recordSourceUsage(primary.source);
          const compare = await this.buildHistoryComparison(symbol, period, interval, compareWith, primary.rows);
          return {
            symbol,
            source: primary.source,
            status: primary.status,
            degradedReason: primary.degradedReason ?? null,
            stalenessSeconds: primary.stalenessSeconds,
            data: {
              symbol,
              period,
              interval,
              rows: primary.rows,
              comparisonHint: compare?.source,
            },
            ...(compare ? { compare_with: compare } : {}),
          };
        } catch (error) {
          return {
            symbol,
            source: "service",
            status: "error",
            degradedReason: summarizeError(error),
            stalenessSeconds: null,
            data: { symbol, period, interval, rows: [] },
          };
        }
      }),
    );
    return this.toBatchRouteResult(items);
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
      const primary = await this.fetchPrimaryFundamentals(symbol, asOfDate || undefined);
      this.recordSourceUsage(primary.source);
      const compare = compareWith ? buildUnavailableCompare(compareWith, "comparison is only implemented for history/quote paths") : undefined;
      return {
        status: 200,
        body: {
          source: primary.source,
          status: primary.status,
          degradedReason: primary.degradedReason ?? null,
          stalenessSeconds: primary.stalenessSeconds,
          data: { symbol, payload: primary.payload },
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
      const payload = await this.fetchPrimaryMetadata(symbol);
      const compare = compareWith ? buildUnavailableCompare(compareWith, "comparison is only implemented for history/quote paths") : undefined;
      return {
        status: 200,
        body: {
          source: "service",
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
    await this.ensureRuntimeReady();
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
    await this.ensureRuntimeReady();
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

  async handleOps(): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    await this.ensureRuntimeReady();
    await this.enforceStreamerFailurePolicy();
    const health = await this.checkHealth();
    const latestUniverse = readJsonFile<MarketDataUniverse>(path.join(this.cacheDir, "base-universe.json"));
    const universeAudit = this.readUniverseAudit(5);
    const serviceOperatorState = this.currentServiceOperatorState();
    return {
      status: 200,
      body: {
        source: "service",
        status: "ok",
        degradedReason: null,
        stalenessSeconds: 0,
        data: {
          streamerRoleConfigured: this.configuredStreamerRole,
          streamerRoleActive: this.activeStreamerRole,
          streamerLockHeld: Boolean(this.leaderLockClient),
          serviceOperatorState,
          serviceOperatorAction: this.currentServiceOperatorAction(),
          sharedStateBackend: this.streamerSharedStateBackend,
          sharedStateUpdatedAt: this.sharedStateCache?.updatedAt ?? (await this.readSharedStreamerState())?.updatedAt ?? null,
          providerMetrics: this.providerMetrics,
          health,
          universe: {
            latest: latestUniverse,
            audit: universeAudit,
            ownership: {
              artifactPath: path.join(this.cacheDir, "base-universe.json"),
              auditPath: path.join(this.cacheDir, "base-universe-audit.jsonl"),
              sourceLadder: this.universeSourceLadder,
              refreshPolicy: "TS owns the artifact refresh path; python_seed is a terminal fallback only.",
            },
          },
        },
      },
    };
  }

  async handleReady(): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    try {
      const health = await this.checkHealth();
      const streamerMeta =
        (((health.providers as Record<string, unknown> | undefined)?.schwabStreamerMeta as Record<string, unknown> | undefined) ?? {});
      const streamerOperatorState = String(streamerMeta.operatorState ?? "healthy");
      const serviceOperatorState = this.currentServiceOperatorState();
      const operatorState = serviceOperatorState !== "healthy" ? serviceOperatorState : streamerOperatorState;
      const ready = !["human_action_required", "max_connections_blocked"].includes(operatorState);
      return {
        status: ready ? 200 : 503,
        body: {
          source: "service",
          status: ready ? "ok" : "degraded",
          degradedReason: ready ? null : `service not ready (${operatorState})`,
          stalenessSeconds: 0,
          data: {
            ready,
            checkedAt: new Date().toISOString(),
            operatorState,
            operatorAction:
              serviceOperatorState !== "healthy"
                ? this.currentServiceOperatorAction()
                : (streamerMeta.operatorAction ?? "No operator action required."),
          },
        },
      };
    } catch (error) {
      return this.toErrorRoute(error, {
        ready: false,
        checkedAt: new Date().toISOString(),
      });
    }
  }

  async handleUniverseAudit(request: Request): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    const limit = Math.max(parseInt(resolveQuery(request.url, "limit", "20"), 10) || 20, 1);
    const audit = this.readUniverseAudit(limit);
    return {
      status: 200,
      body: {
        source: "service",
        status: "ok",
        degradedReason: null,
        stalenessSeconds: 0,
        data: { entries: audit },
      },
    };
  }

  private async fetchPrimaryHistory(
    symbol: string,
    period: string,
    interval: HistoryInterval,
    provider: HistoryProvider = "service",
  ): Promise<HistoryFetchResult> {
    if (provider === "schwab") {
      if (!this.isSchwabConfigured()) {
        throw new Error("Schwab credentials are not configured");
      }
      const rows = await this.fetchSchwabHistory(symbol, period, interval);
      return { source: "schwab", status: "ok", stalenessSeconds: 0, rows };
    }
    if (provider === "yahoo") {
      const rows = await this.fetchYahooHistory(symbol, period, interval);
      return { source: "yahoo", status: "ok", stalenessSeconds: 0, rows };
    }
    if (provider === "alpaca") {
      const rows = await this.fetchAlpacaHistory(symbol, period, interval);
      return { source: "alpaca", status: "ok", stalenessSeconds: 0, rows };
    }

    const reasons: string[] = [];
    if (this.isSchwabConfigured()) {
      if (this.shouldSkipSchwabRest()) {
        reasons.push(this.currentSchwabRestSkipReason());
      } else {
        try {
          const rows = await this.fetchSchwabHistory(symbol, period, interval);
          return { source: "schwab", status: "ok", stalenessSeconds: 0, rows };
        } catch (error) {
          this.recordSchwabRestFailure(error);
          reasons.push(summarizeError(error));
          this.logger.error(`Schwab history failed for ${symbol}`, error);
        }
      }
    }

    const rows = await this.fetchYahooHistory(symbol, period, interval);
    this.recordYahooFallbackSuccess();
    return {
      source: "yahoo",
      status: reasons.length ? "degraded" : "ok",
      degradedReason: reasons.length ? `Schwab unavailable; using Yahoo fallback (${reasons[0]})` : null,
      stalenessSeconds: 0,
      rows,
    };
  }

  private async fetchPrimaryQuote(symbol: string): Promise<QuoteFetchResult> {
    await this.enforceStreamerFailurePolicy();
    const reasons: string[] = [];
    const isFuturesSymbol = symbol.startsWith("/");
    if (this.isSchwabConfigured()) {
      try {
        const streamed = isFuturesSymbol ? await this.streamer?.getFuturesQuote(symbol) : await this.streamer?.getQuote(symbol);
        if (streamed?.price != null) {
          return { source: "schwab_streamer", status: "ok", stalenessSeconds: 0, quote: streamed };
        }
      } catch (error) {
        reasons.push(`Schwab streamer failed: ${summarizeError(error)}`);
      }
      const shared = isFuturesSymbol ? await this.readSharedStreamerFuturesQuote(symbol) : await this.readSharedStreamerQuote(symbol);
      if (shared?.price != null) {
        return { source: "schwab_streamer_shared", status: "ok", stalenessSeconds: 0, quote: shared };
      }
      if (isFuturesSymbol) {
        throw new Error(reasons[0] ?? `No live Schwab futures quote available for ${symbol}`);
      }
      if (this.shouldSkipSchwabRest()) {
        reasons.push(this.currentSchwabRestSkipReason());
      } else {
        try {
          const quote = await this.fetchSchwabQuote(symbol);
          return { source: "schwab", status: "ok", stalenessSeconds: 0, quote };
        } catch (error) {
          this.recordSchwabRestFailure(error);
          reasons.push(summarizeError(error));
          this.logger.error(`Schwab quote failed for ${symbol}`, error);
        }
      }
    }

    const quote = await this.fetchYahooQuote(symbol);
    this.recordYahooFallbackSuccess();
    return {
      source: "yahoo",
      status: reasons.length ? "degraded" : "ok",
      degradedReason: reasons.length ? `Schwab unavailable; using Yahoo fallback (${reasons[0]})` : null,
      stalenessSeconds: 0,
      quote,
    };
  }

  private async fetchPrimarySnapshot(symbol: string): Promise<SnapshotFetchResult> {
    await this.enforceStreamerFailurePolicy();
    const quote = await this.fetchPrimaryQuote(symbol);
    const chartEquity =
      symbol.startsWith("/")
        ? null
        : (await this.streamer?.getChartEquity(symbol).catch(() => null)) ?? (await this.readSharedStreamerChart(symbol));
    const [metadata, fundamentals] = await Promise.all([
      symbol.startsWith("/") ? Promise.resolve({}) : this.fetchPrimaryMetadata(symbol).catch(() => ({})),
      symbol.startsWith("/") ? Promise.resolve({}) : this.fetchPrimaryFundamentals(symbol).then((result) => result.payload).catch(() => ({})),
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
        ...(chartEquity ? { chartEquity } : {}),
      },
    };
  }

  private async fetchPrimaryFundamentals(
    symbol: string,
    asOfDate?: string,
  ): Promise<ServiceMetadata & { payload: Record<string, unknown> }> {
    const reasons: string[] = [];
    const targetAsOfDate = asOfDate || new Date().toISOString().slice(0, 10);
    let schwabPayload: Record<string, unknown> = {};
    if (this.isSchwabConfigured()) {
      if (this.shouldSkipSchwabRest()) {
        reasons.push(this.currentSchwabRestSkipReason());
      } else {
        try {
          schwabPayload = (await this.fetchSchwabQuoteEnvelope(symbol, targetAsOfDate)).fundamentals;
        } catch (error) {
          this.recordSchwabRestFailure(error);
          reasons.push(summarizeError(error));
          this.logger.error(`Schwab fundamentals failed for ${symbol}`, error);
        }
      }
    }

    const yahooPayload = await this.fetchYahooFundamentals(symbol, targetAsOfDate).catch((error) => {
      reasons.push(`Yahoo fundamentals failed: ${summarizeError(error)}`);
      return {};
    });
    if (Object.keys(schwabPayload).length) {
      const merged = mergePreferPrimary(schwabPayload, yahooPayload);
      return {
        source: Object.keys(yahooPayload).length ? "schwab" : "schwab",
        status: Object.keys(yahooPayload).length && reasons.length ? "degraded" : "ok",
        degradedReason:
          Object.keys(yahooPayload).length && reasons.length
            ? `Schwab fundamentals supplemented by Yahoo fallback (${reasons[0]})`
            : reasons.length && !Object.keys(yahooPayload).length
              ? reasons[0]
              : null,
        stalenessSeconds: 0,
        payload: merged,
      };
    }
    if (Object.keys(yahooPayload).length) {
      this.recordYahooFallbackSuccess();
      return {
        source: "yahoo",
        status: reasons.length ? "degraded" : "ok",
        degradedReason: reasons.length ? `Schwab unavailable; using Yahoo fallback (${reasons[0]})` : null,
        stalenessSeconds: 0,
        payload: yahooPayload,
      };
    }
    throw new Error(reasons[0] ?? `Unable to fetch fundamentals for ${symbol}`);
  }

  private async fetchPrimaryMetadata(symbol: string): Promise<Record<string, unknown>> {
    const reasons: string[] = [];
    let schwabPayload: Record<string, unknown> = {};
    if (this.isSchwabConfigured()) {
      if (this.shouldSkipSchwabRest()) {
        reasons.push(this.currentSchwabRestSkipReason());
      } else {
        try {
          schwabPayload = (await this.fetchSchwabQuoteEnvelope(symbol)).metadata;
        } catch (error) {
          this.recordSchwabRestFailure(error);
          reasons.push(summarizeError(error));
        }
      }
    }
    const yahooPayload = await this.fetchYahooMetadata(symbol).catch(() => ({}));
    if (Object.keys(schwabPayload).length) {
      return mergePreferPrimary(schwabPayload, yahooPayload);
    }
    if (Object.keys(yahooPayload).length) {
      if (reasons.length) {
        this.recordYahooFallbackSuccess();
      }
      return yahooPayload;
    }
    throw new Error(reasons[0] ?? `Unable to fetch metadata for ${symbol}`);
  }

  private async buildHistoryComparison(
    symbol: string,
    period: string,
    interval: HistoryInterval,
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
        rows = await this.fetchYahooHistory(symbol, period, interval);
      } else if (source === "alpaca") {
        rows = await this.fetchAlpacaHistory(symbol, period, interval);
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

  private async fetchYahooHistory(
    symbol: string,
    period: string,
    interval: HistoryInterval = DEFAULT_INTERVAL,
  ): Promise<MarketDataHistoryPoint[]> {
    return this.runYahooRequest("history", async () => {
      const range = normalizeYahooRange(period);
      const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
      url.searchParams.set("range", range);
      url.searchParams.set("interval", interval);
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
    });
  }

  private async fetchYahooQuote(symbol: string): Promise<MarketDataQuote> {
    return this.runYahooRequest("quote", async () => {
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
        volume: toNumber(result.regularMarketVolume) ?? undefined,
        week52High: toNumber(result.fiftyTwoWeekHigh) ?? undefined,
        week52Low: toNumber(result.fiftyTwoWeekLow) ?? undefined,
      };
    });
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
    return this.runYahooRequest("news", async () => {
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
    });
  }

  private async fetchYahooQuoteSummary(symbol: string, modules: string[]): Promise<JsonRecord> {
    return this.runYahooRequest("quoteSummary", async () => {
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
    });
  }

  private isSchwabConfigured(): boolean {
    return Boolean(
      this.config.SCHWAB_CLIENT_ID.trim() &&
        this.config.SCHWAB_CLIENT_SECRET.trim() &&
        this.config.SCHWAB_REFRESH_TOKEN.trim(),
    );
  }

  private async fetchSchwabStreamerPreferences(): Promise<SchwabStreamerPreferences> {
    const token = await this.getSchwabAccessToken();
    const defaultUrl = `${this.config.SCHWAB_API_BASE_URL.replace(/\/+$/, "")}/trader/v1/userPreference`;
    const url = this.config.SCHWAB_USER_PREFERENCES_URL.trim() || defaultUrl;
    const payload = await this.fetchJson<JsonRecord | JsonRecord[]>(url, {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    });
    const root = Array.isArray(payload) ? ((payload[0] as JsonRecord | undefined) ?? {}) : payload;
    const streamerInfo = ((Array.isArray(root.streamerInfo) ? root.streamerInfo[0] : root.streamerInfo) as JsonRecord | undefined) ?? root;
    const prefs: SchwabStreamerPreferences = {
      streamerSocketUrl: firstString(streamerInfo.streamerSocketUrl, streamerInfo.socketUrl, streamerInfo.streamerUrl) ?? "",
      schwabClientCustomerId: firstString(
        streamerInfo.schwabClientCustomerId,
        root.schwabClientCustomerId,
        root.accountId,
      ) ?? "",
      schwabClientCorrelId: firstString(streamerInfo.schwabClientCorrelId, root.schwabClientCorrelId) ?? "",
      schwabClientChannel: firstString(streamerInfo.schwabClientChannel, root.schwabClientChannel) ?? "",
      schwabClientFunctionId: firstString(streamerInfo.schwabClientFunctionId, root.schwabClientFunctionId) ?? "",
    };
    if (
      !prefs.streamerSocketUrl ||
      !prefs.schwabClientCustomerId ||
      !prefs.schwabClientCorrelId ||
      !prefs.schwabClientChannel ||
      !prefs.schwabClientFunctionId
    ) {
      throw new Error("Schwab user preferences did not include complete streamer connection details");
    }
    this.recordSchwabRestSuccess();
    return prefs;
  }

  private createStreamer(websocketFactory?: WebSocketFactory): SchwabStreamerSession {
    return new SchwabStreamerSession({
      logger: this.logger,
      websocketFactory,
      accessTokenProvider: () => this.getSchwabAccessToken(),
      preferencesProvider: () => this.fetchSchwabStreamerPreferences(),
      connectTimeoutMs: this.config.SCHWAB_STREAMER_CONNECT_TIMEOUT_MS,
      freshnessTtlMs: this.config.SCHWAB_STREAMER_QUOTE_TTL_MS,
      subscriptionSoftCap: this.config.SCHWAB_STREAMER_SYMBOL_SOFT_CAP,
      cacheSoftCap: this.config.SCHWAB_STREAMER_CACHE_SOFT_CAP,
      subscriptionFields: this.config.SCHWAB_STREAMER_EQUITY_FIELDS,
      accountActivityEnabled: !["0", "false", "no", "off"].includes(
        this.config.SCHWAB_STREAMER_ACCOUNT_ACTIVITY_ENABLED.trim().toLowerCase(),
      ),
      reconnectJitterMs: this.config.SCHWAB_STREAMER_RECONNECT_JITTER_MS,
      stateSink: (state) => {
        void this.writeSharedStreamerState(state);
      },
    });
  }

  private async enforceStreamerFailurePolicy(): Promise<void> {
    const streamer = this.streamer;
    if (!streamer) {
      return;
    }
    const health = streamer.getHealth();
    if (!health) {
      return;
    }
    if (health.failurePolicy !== "max_connections_exceeded" || this.activeStreamerRole !== "leader") {
      return;
    }
    this.logger.error("Demoting Schwab streamer leader after CLOSE_CONNECTION / max connection policy");
    streamer.close();
    this.streamer = null;
    if (this.leaderLockClient) {
      try {
        await this.leaderLockClient.query("SELECT pg_advisory_unlock($1)", [this.streamerPgLockKey]);
      } catch (error) {
        this.logger.error("Unable to release Schwab streamer advisory lock during demotion", error);
      } finally {
        this.leaderLockClient.release();
        this.leaderLockClient = null;
      }
    }
    this.activeStreamerRole = "follower";
  }

  private async ensureRuntimeReady(): Promise<void> {
    if (this.runtimeReadyPromise) {
      return this.runtimeReadyPromise;
    }
    this.runtimeReadyPromise = (async () => {
      if (this.streamerSharedStateBackend === "postgres" || this.configuredStreamerRole === "auto") {
        await this.ensureDB();
      }
      if (this.streamerSharedStateBackend === "postgres") {
        await this.setupSharedStateListener();
      }
      if (this.configuredStreamerRole === "auto") {
        const acquired = await this.tryAcquireStreamerLeadership();
        this.activeStreamerRole = acquired ? "leader" : "follower";
      }
      if (this.streamerEnabled && this.activeStreamerRole === "leader" && !this.streamer && this.isSchwabConfigured()) {
        this.streamer = this.createStreamer();
      }
    })();
    try {
      await this.runtimeReadyPromise;
    } catch (error) {
      this.runtimeReadyPromise = null;
      throw error;
    }
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
        await client.query(`
          CREATE TABLE IF NOT EXISTS market_data_streamer_state (
            stream_name text PRIMARY KEY,
            payload jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
          )
        `);
      } finally {
        client.release();
      }
      this.pool = pool;
    })();
    return this.dbReadyPromise;
  }

  private async tryAcquireStreamerLeadership(): Promise<boolean> {
    if (!this.pool) {
      return false;
    }
    if (this.leaderLockClient) {
      return true;
    }
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [
        this.streamerPgLockKey,
      ]);
      if (result.rows[0]?.acquired) {
        this.leaderLockClient = client;
        return true;
      }
      client.release();
      return false;
    } catch (error) {
      client.release();
      throw error;
    }
  }

  private async setupSharedStateListener(): Promise<void> {
    if (!this.pool || this.sharedStateListenerClient) {
      return;
    }
    const client = await this.pool.connect();
    client.on("notification", (message) => {
      this.providerMetrics.lastSharedStateNotificationAt = new Date().toISOString();
      const payload = parseSharedStateNotification(message.payload);
      if (
        payload?.updatedAt &&
        this.sharedStateCache?.updatedAt &&
        this.sharedStateCache.updatedAt >= payload.updatedAt
      ) {
        return;
      }
      void this.refreshSharedStateCacheFromBackend();
    });
    await client.query("LISTEN market_data_streamer_state_changed");
    this.sharedStateListenerClient = client;
    await this.refreshSharedStateCacheFromBackend();
  }

  private async fetchSchwabHistory(symbol: string, period: string, interval: HistoryInterval): Promise<MarketDataHistoryPoint[]> {
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
    this.recordSchwabRestSuccess();
    return rows;
  }

  private async fetchSchwabQuote(symbol: string): Promise<MarketDataQuote> {
    return (await this.fetchSchwabQuoteEnvelope(symbol)).quote;
  }

  private async fetchSchwabQuoteEnvelope(symbol: string, asOfDate?: string): Promise<SchwabQuoteEnvelope> {
    const token = await this.getSchwabAccessToken();
    const url = new URL(`${this.config.SCHWAB_API_BASE_URL.replace(/\/+$/, "")}/marketdata/v1/quotes`);
    url.searchParams.set("symbols", symbol);
    url.searchParams.set("fields", "quote,fundamental");
    const payload = await this.fetchJson<JsonRecord>(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    });
    const envelope = normalizeSchwabQuoteEnvelope(payload, symbol, asOfDate || new Date().toISOString().slice(0, 10));
    this.recordSchwabRestSuccess();
    return envelope;
  }

  private async fetchAlpacaHistory(
    symbol: string,
    period: string,
    interval: HistoryInterval = DEFAULT_INTERVAL,
  ): Promise<MarketDataHistoryPoint[]> {
    const keys = await this.getAlpacaKeys();
    const url = new URL(`${keys.data_url}/v2/stocks/${encodeURIComponent(symbol)}/bars`);
    url.searchParams.set("timeframe", mapAlpacaTimeframe(interval));
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
    if (this.tokenRefreshPromise) {
      return this.tokenRefreshPromise;
    }

    this.providerMetrics.tokenRefreshInFlight = true;
    this.tokenRefreshPromise = (async () => {
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
      let payload: JsonRecord;
      try {
        payload = await readJsonResponse<JsonRecord>(response);
      } catch (error) {
        this.providerMetrics.lastTokenRefreshFailureAt = new Date().toISOString();
        if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
          this.providerMetrics.schwabTokenStatus = "human_action_required";
          this.providerMetrics.schwabTokenReason = "Schwab refresh token was rejected. Re-authorize the developer app and update the refresh token.";
          throw new Error("Schwab refresh token rejected (401/403). Manual re-authentication is required.");
        }
        this.recordSchwabRestFailure(error);
        throw error;
      }
      const accessToken = String(payload.access_token ?? "").trim();
      const expiresIn = Number(payload.expires_in ?? 1800);
      if (!accessToken) {
        throw new Error("Schwab token refresh returned no access token");
      }
      this.writeCachedSchwabToken({
        accessToken,
        expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000,
      });
      this.providerMetrics.lastTokenRefreshAt = new Date().toISOString();
      this.providerMetrics.schwabTokenStatus = "ready";
      this.providerMetrics.schwabTokenReason = null;
      this.recordSchwabRestSuccess();
      return accessToken;
    })();
    try {
      return await this.tokenRefreshPromise;
    } finally {
      this.tokenRefreshPromise = null;
      this.providerMetrics.tokenRefreshInFlight = false;
    }
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
    const payload = await this.universeManager.loadOrRefreshArtifact(forceRefresh);
    this.providerMetrics.lastSuccessfulUniverseRefreshAt = payload.updatedAt;
    return payload;
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

  private recordSchwabRestSuccess(): void {
    this.providerMetrics.lastSuccessfulSchwabRestAt = new Date().toISOString();
    this.providerMetrics.lastSchwabFailureAt = null;
    this.providerMetrics.schwabConsecutiveFailures = 0;
    this.providerMetrics.schwabCooldownUntil = null;
    this.schwabCooldownUntilMs = 0;
  }

  private recordSchwabRestFailure(error: unknown): void {
    this.providerMetrics.lastSchwabFailureAt = new Date().toISOString();
    this.providerMetrics.schwabConsecutiveFailures += 1;
    if (this.providerMetrics.schwabConsecutiveFailures < this.schwabFailureThreshold) {
      return;
    }
    this.schwabCooldownUntilMs = Date.now() + this.schwabCooldownMs;
    this.providerMetrics.schwabCooldownUntil = new Date(this.schwabCooldownUntilMs).toISOString();
    if (error instanceof Error && error.message.includes("Manual re-authentication")) {
      this.providerMetrics.schwabTokenStatus = "human_action_required";
    }
  }

  private isSchwabCooldownOpen(): boolean {
    if (!this.schwabCooldownUntilMs) {
      return false;
    }
    if (Date.now() >= this.schwabCooldownUntilMs) {
      this.schwabCooldownUntilMs = 0;
      this.providerMetrics.schwabCooldownUntil = null;
      this.providerMetrics.schwabConsecutiveFailures = 0;
      return false;
    }
    return true;
  }

  private shouldSkipSchwabRest(): boolean {
    return this.providerMetrics.schwabTokenStatus === "human_action_required" || this.isSchwabCooldownOpen();
  }

  private currentSchwabRestSkipReason(): string {
    if (this.providerMetrics.schwabTokenStatus === "human_action_required") {
      return this.providerMetrics.schwabTokenReason ?? "Schwab credentials require manual re-authentication";
    }
    if (this.isSchwabCooldownOpen()) {
      return `Schwab REST cooldown open until ${this.providerMetrics.schwabCooldownUntil}`;
    }
    return "Schwab REST temporarily unavailable";
  }

  private recordYahooFallbackSuccess(): void {
    this.recordYahooSuccess();
    this.providerMetrics.lastSuccessfulYahooFallbackAt = new Date().toISOString();
    this.providerMetrics.fallbackUsage.yahoo = (this.providerMetrics.fallbackUsage.yahoo ?? 0) + 1;
  }

  private recordYahooSuccess(): void {
    this.providerMetrics.yahooConsecutiveFailures = 0;
    this.yahooCircuitOpenUntilMs = 0;
    this.providerMetrics.yahooCircuitOpenUntil = null;
  }

  private recordYahooFailure(): void {
    this.providerMetrics.yahooConsecutiveFailures += 1;
    if (this.providerMetrics.yahooConsecutiveFailures < this.yahooCircuitFailureThreshold) {
      return;
    }
    this.yahooCircuitOpenUntilMs = Date.now() + this.yahooCircuitCooldownMs;
    this.providerMetrics.yahooCircuitOpenUntil = new Date(this.yahooCircuitOpenUntilMs).toISOString();
  }

  private isYahooCircuitOpen(): boolean {
    if (!this.yahooCircuitOpenUntilMs) {
      return false;
    }
    if (Date.now() >= this.yahooCircuitOpenUntilMs) {
      this.yahooCircuitOpenUntilMs = 0;
      this.providerMetrics.yahooCircuitOpenUntil = null;
      this.providerMetrics.yahooConsecutiveFailures = 0;
      return false;
    }
    return true;
  }

  private async runYahooRequest<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    if (this.isYahooCircuitOpen()) {
      throw new Error(`Yahoo circuit open for ${operation} until ${this.providerMetrics.yahooCircuitOpenUntil}`);
    }
    try {
      const result = await fn();
      this.recordYahooSuccess();
      return result;
    } catch (error) {
      this.recordYahooFailure();
      throw error;
    }
  }

  private recordSharedStateFallbackSuccess(): void {
    this.providerMetrics.fallbackUsage.shared_state = (this.providerMetrics.fallbackUsage.shared_state ?? 0) + 1;
  }

  private recordSourceUsage(source: string): void {
    this.providerMetrics.sourceUsage[source] = (this.providerMetrics.sourceUsage[source] ?? 0) + 1;
  }

  private currentServiceOperatorState(): string {
    if (this.providerMetrics.schwabTokenStatus === "human_action_required") {
      return "human_action_required";
    }
    if (this.isSchwabCooldownOpen()) {
      return "provider_cooldown";
    }
    return "healthy";
  }

  private currentServiceOperatorAction(): string {
    if (this.providerMetrics.schwabTokenStatus === "human_action_required") {
      return this.providerMetrics.schwabTokenReason ?? "Re-authorize Schwab access and refresh the cached refresh token.";
    }
    if (this.isSchwabCooldownOpen()) {
      return `Schwab REST is cooling down after repeated failures. Wait until ${this.providerMetrics.schwabCooldownUntil} or inspect upstream connectivity/auth.`;
    }
    return "No operator action required.";
  }

  private toBatchRouteResult(items: Array<Record<string, unknown>>): MarketDataRouteResult<Record<string, unknown>> {
    const successCount = items.filter((item) => String(item.status ?? "") !== "error").length;
    const status = successCount === items.length ? "ok" : successCount > 0 ? "degraded" : "error";
    return {
      status: successCount > 0 ? 200 : 503,
      body: {
        source: "service",
        status,
        degradedReason: successCount === items.length ? null : `${items.length - successCount} batch item(s) failed`,
        stalenessSeconds: 0,
        data: { items },
      },
    };
  }

  private async writeSharedStreamerState(state: SharedStreamerState): Promise<void> {
    if (this.streamerSharedStateBackend === "postgres") {
      if (!this.pool) {
        return;
      }
      try {
        await this.pool.query(
          `
            INSERT INTO market_data_streamer_state (stream_name, payload, updated_at)
            VALUES ($1, $2::jsonb, now())
            ON CONFLICT (stream_name)
            DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
          `,
          ["schwab_market_data", JSON.stringify(state)],
        );
        await this.pool.query("SELECT pg_notify('market_data_streamer_state_changed', $1)", [
          JSON.stringify({
            updatedAt: state.updatedAt,
            quoteCount: Object.keys(state.quotes).length,
            chartCount: Object.keys(state.charts).length,
          }),
        ]);
      } catch (error) {
        this.logger.error("Unable to persist shared Schwab streamer state to Postgres", error);
      }
      this.sharedStateCache = state;
      this.sharedStateCacheMtimeMs = null;
      return;
    }
    try {
      fs.mkdirSync(path.dirname(this.streamerSharedStatePath), { recursive: true });
      fs.writeFileSync(this.streamerSharedStatePath, JSON.stringify(state, null, 2));
      this.sharedStateCache = state;
      this.sharedStateCacheMtimeMs = fs.statSync(this.streamerSharedStatePath).mtimeMs;
    } catch (error) {
      this.logger.error("Unable to persist shared Schwab streamer state", error);
    }
  }

  private async readSharedStreamerState(): Promise<SharedStreamerState | null> {
    if (this.streamerSharedStateBackend === "file" && this.sharedStateCache) {
      try {
        const fileMtimeMs = fs.statSync(this.streamerSharedStatePath).mtimeMs;
        if (this.sharedStateCacheMtimeMs != null && fileMtimeMs <= this.sharedStateCacheMtimeMs) {
          return this.sharedStateCache;
        }
      } catch {
        return this.sharedStateCache;
      }
    } else if (this.sharedStateCache) {
      return this.sharedStateCache;
    }
    if (this.streamerSharedStateBackend === "postgres") {
      if (!this.pool) {
        return null;
      }
      try {
        const result = await this.pool.query<{ payload: SharedStreamerState }>(
          "SELECT payload FROM market_data_streamer_state WHERE stream_name = $1",
          ["schwab_market_data"],
        );
        this.sharedStateCache = result.rows[0]?.payload ?? null;
        return this.sharedStateCache;
      } catch (error) {
        this.logger.error("Unable to read shared Schwab streamer state from Postgres", error);
        return null;
      }
    }
    this.sharedStateCache = readJsonFile<SharedStreamerState>(this.streamerSharedStatePath);
    try {
      this.sharedStateCacheMtimeMs = fs.statSync(this.streamerSharedStatePath).mtimeMs;
    } catch {
      this.sharedStateCacheMtimeMs = null;
    }
    return this.sharedStateCache;
  }

  private async readSharedStreamerQuote(symbol: string): Promise<MarketDataQuote | null> {
    if (this.activeStreamerRole !== "follower") {
      return null;
    }
    const state = await this.readSharedStreamerState();
    const quote = state?.quotes?.[symbol];
    if (!quote?.receivedAt || !quote.quote) {
      return null;
    }
    const ageSeconds = this.secondsSince(quote.receivedAt);
    if (ageSeconds == null || ageSeconds > Math.round(this.config.SCHWAB_STREAMER_QUOTE_TTL_MS / 1000)) {
      return null;
    }
    this.recordSharedStateFallbackSuccess();
    return quote.quote;
  }

  private async readSharedStreamerFuturesQuote(symbol: string): Promise<MarketDataQuote | null> {
    if (this.activeStreamerRole !== "follower") {
      return null;
    }
    const state = await this.readSharedStreamerState();
    const quote = state?.futuresQuotes?.[symbol];
    if (!quote?.receivedAt || !quote.quote) {
      return null;
    }
    const ageSeconds = this.secondsSince(quote.receivedAt);
    if (ageSeconds == null || ageSeconds > Math.round(this.config.SCHWAB_STREAMER_QUOTE_TTL_MS / 1000)) {
      return null;
    }
    this.recordSharedStateFallbackSuccess();
    return quote.quote;
  }

  private async readSharedStreamerChart(symbol: string): Promise<Record<string, unknown> | null> {
    if (this.activeStreamerRole !== "follower") {
      return null;
    }
    const state = await this.readSharedStreamerState();
    const chart = state?.charts?.[symbol];
    if (!chart?.receivedAt || !chart.point) {
      return null;
    }
    const ageSeconds = this.secondsSince(chart.receivedAt);
    if (ageSeconds == null || ageSeconds > Math.round(this.config.SCHWAB_STREAMER_QUOTE_TTL_MS / 1000)) {
      return null;
    }
    this.recordSharedStateFallbackSuccess();
    return chart.point as unknown as Record<string, unknown>;
  }

  private async refreshSharedStateCacheFromBackend(): Promise<void> {
    if (this.streamerSharedStateBackend !== "postgres" || !this.pool) {
      return;
    }
    try {
      const result = await this.pool.query<{ payload: SharedStreamerState }>(
        "SELECT payload FROM market_data_streamer_state WHERE stream_name = $1",
        ["schwab_market_data"],
      );
      this.sharedStateCache = result.rows[0]?.payload ?? null;
      this.sharedStateCacheMtimeMs = null;
    } catch (error) {
      this.logger.error("Unable to refresh shared Schwab streamer state cache", error);
    }
  }

  private readUniverseAudit(limit: number): UniverseAuditEntry[] {
    return this.universeManager.readAudit(limit);
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

function mergePreferPrimary(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fallback };
  for (const [key, value] of Object.entries(primary)) {
    if (value !== undefined && value !== null && value !== "") {
      out[key] = value;
    } else if (!(key in out)) {
      out[key] = value;
    }
  }
  return out;
}

function resolveRepoPath(rawPath: string): string {
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  return path.join(repoRoot, rawPath);
}

function resolveOptionalRepoPath(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }
  return resolveRepoPath(trimmed);
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
