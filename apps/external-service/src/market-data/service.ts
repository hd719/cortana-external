import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import type { AppConfig } from "../config.js";
import { HttpError } from "../lib/http.js";
import type { AppLogger } from "../lib/logger.js";
import { createLogger } from "../lib/logger.js";
import { type HistoryInterval } from "./history-utils.js";
import { buildRiskPayload, type RiskPayloadResult } from "./risk-stack.js";
import { CoinMarketCapService } from "./coinmarketcap-service.js";
import type { WebSocketFactory } from "./streamer.js";
import type { PendingSchwabAuthState } from "./schwab-auth.js";
import type { SchwabStreamerPreferences } from "./schwab-market-client.js";
import { SchwabStreamerRuntime } from "./schwab-streamer-runtime.js";
import { AlpacaClient } from "./alpaca-client.js";
import { ProviderChain } from "./provider-chain.js";
import { buildHealthReport, buildOpsPayload, getServiceOperatorAction, getServiceOperatorState } from "./ops-reporter.js";
import { MarketDataGovernanceReporter } from "./governance-reporter.js";
import { SchwabRestClient, type ProviderMetrics } from "./schwab-rest-client.js";
import { MarketDataQueryRoutes } from "./query-routes.js";
import { MarketDataSupportRoutes } from "./support-routes.js";
import { SchwabAuthRoutes } from "./auth-routes.js";
import { MarketDataAdminRoutes } from "./admin-routes.js";
import { UniverseArtifactManager } from "./universe-manager.js";
import type {
  MarketDataGenericPayload,
  MarketDataHistory,
  MarketDataProviderMode,
  MarketDataQuote,
  MarketDataRiskHistory,
  MarketDataRiskSnapshot,
  MarketDataRouteResult,
  MarketDataSnapshot,
  MarketDataUniverse,
} from "./types.js";
import {
  dedupe,
  parseUniverseSourceLadder,
  readJsonFile,
} from "./universe-utils.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DEFAULT_INTERVAL = "1d";
type FetchImpl = typeof fetch;

interface MarketDataServiceConfig {
  config?: AppConfig;
  logger?: AppLogger;
  fetchImpl?: FetchImpl;
  websocketFactory?: WebSocketFactory;
}

export class MarketDataService {
  private readonly logger: AppLogger;
  private readonly fetchImpl: FetchImpl;
  private readonly config: AppConfig;
  private readonly requestTimeoutMs: number;
  private readonly cacheDir: string;
  private readonly universeSourceLadder: string[];
  private readonly universeRemoteJsonUrl: string;
  private readonly universeLocalJsonPath: string | null;
  private readonly schwabTokenPath: string;
  private readonly schwabStreamerTokenPath: string;
  private readonly universeManager: UniverseArtifactManager;
  private readonly coinMarketCap: CoinMarketCapService;
  private readonly schwabRestClient: SchwabRestClient;
  private readonly schwabStreamerClient: SchwabRestClient;
  private readonly streamerRuntime: SchwabStreamerRuntime;
  private readonly providerChain: ProviderChain;
  private readonly queryRoutes: MarketDataQueryRoutes;
  private readonly supportRoutes: MarketDataSupportRoutes;
  private readonly authRoutes: SchwabAuthRoutes;
  private readonly streamerAuthRoutes: SchwabAuthRoutes;
  private readonly adminRoutes: MarketDataAdminRoutes;
  private readonly governanceReporter: MarketDataGovernanceReporter;
  private readonly providerMetrics: ProviderMetrics = {
    lastSuccessfulSchwabRestAt: null,
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
    sourceUsage: {},
    fallbackUsage: {},
  };
  private readonly streamerProviderMetrics: ProviderMetrics = {
    lastSuccessfulSchwabRestAt: null,
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
    sourceUsage: {},
    fallbackUsage: {},
  };
  private pendingSchwabAuthState: PendingSchwabAuthState | null = null;
  private pendingSchwabStreamerAuthState: PendingSchwabAuthState | null = null;

  constructor(config: MarketDataServiceConfig = {}) {
    this.logger = config.logger ?? createLogger("market-data");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.config = config.config ?? ({
      PORT: 3033,
      MARKET_DATA_CACHE_DIR: ".cache/market_data",
      MARKET_DATA_REQUEST_TIMEOUT_MS: 30_000,
      MARKET_DATA_UNIVERSE_SOURCE_LADDER: "local_json",
      MARKET_DATA_UNIVERSE_REMOTE_JSON_URL: "",
      MARKET_DATA_UNIVERSE_LOCAL_JSON_PATH: "config/universe/sp500-constituents.json",
      MARKET_DATA_SCHWAB_FAILURE_THRESHOLD: 3,
      MARKET_DATA_SCHWAB_COOLDOWN_MS: 20_000,
      COINMARKETCAP_API_KEY: "",
      COINMARKETCAP_API_BASE_URL: "https://pro-api.coinmarketcap.com",
      SCHWAB_CLIENT_ID: "",
      SCHWAB_CLIENT_SECRET: "",
      SCHWAB_REFRESH_TOKEN: "",
      SCHWAB_CLIENT_STREAMER_ID: "",
      SCHWAB_CLIENT_STREAMER_SECRET: "",
      SCHWAB_STREAMER_REFRESH_TOKEN: "",
      SCHWAB_AUTH_URL: "https://api.schwabapi.com/v1/oauth/authorize",
      SCHWAB_REDIRECT_URL: "https://127.0.0.1:8182/auth/schwab/callback",
      SCHWAB_TOKEN_PATH: ".cache/market_data/schwab-token.json",
      SCHWAB_STREAMER_TOKEN_PATH: ".cache/market_data/schwab-streamer-token.json",
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
      SCHWAB_STREAMER_AFTER_HOURS_QUOTE_TTL_MS: 259_200_000,
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
      WHOOP_WEBHOOK_ENABLED: "false",
      WHOOP_WEBHOOK_SECRET: "",
      WHOOP_WEBHOOK_PUBLIC_URL: "",
      WHOOP_WEBHOOK_REPLAY_WINDOW_SECONDS: 300,
      WHOOP_WEBHOOK_RAW_RETENTION_DAYS: 30,
      WHOOP_WEBHOOK_COALESCE_WINDOW_MS: 45_000,
      WHOOP_WEBHOOK_PROCESSOR_INTERVAL_MS: 15_000,
      WHOOP_WEBHOOK_PROCESS_BATCH_SIZE: 5,
      WHOOP_WEBHOOK_BODY_LIMIT_BYTES: 65_536,
      WHOOP_LIVE_EVENT_TELEGRAM_ENABLED: "true",
      WHOOP_LIVE_EVENT_TELEGRAM_ACCOUNT_ID: "spartan",
      TONAL_EMAIL: "",
      TONAL_PASSWORD: "",
      TONAL_TOKEN_PATH: "tonal_tokens.json",
      TONAL_DATA_PATH: "tonal_data.json",
      APPLE_HEALTH_DATA_PATH: path.join(os.homedir(), ".openclaw/data/apple-health/latest.json"),
      APPLE_HEALTH_MAX_AGE_HOURS: 36,
      APPLE_HEALTH_API_TOKEN: "",
      POLYMARKET_API_KEY: "",
      POLYMARKET_KEY_ID: "",
      POLYMARKET_CLIENT_KEY: "",
      POLYMARKET_SECRET_KEY: "",
      POLYMARKET_SECRET: "",
      POLYMARKET_PUBLIC_BASE_URL: "https://gateway.polymarket.us",
      POLYMARKET_API_BASE_URL: "https://api.polymarket.us",
      POLYMARKET_REQUEST_TIMEOUT_MS: 15_000,
      POLYMARKET_PINNED_MARKETS_PATH: ".cache/polymarket/pinned-markets.json",
      ALPACA_KEYS_PATH: "",
      ALPACA_TARGET_ENVIRONMENT: "live",
      CORTANA_DATABASE_URL: "postgres://localhost:5432/cortana?sslmode=disable",
      EXTERNAL_SERVICE_TLS_PORT: 8182,
      EXTERNAL_SERVICE_TLS_CERT_PATH: "",
      EXTERNAL_SERVICE_TLS_KEY_PATH: "",
    } satisfies AppConfig);
    this.requestTimeoutMs = this.config.MARKET_DATA_REQUEST_TIMEOUT_MS;
    this.cacheDir = resolveRepoPath(this.config.MARKET_DATA_CACHE_DIR);
    this.universeSourceLadder = parseUniverseSourceLadder(this.config.MARKET_DATA_UNIVERSE_SOURCE_LADDER);
    this.universeRemoteJsonUrl = this.config.MARKET_DATA_UNIVERSE_REMOTE_JSON_URL.trim();
    this.universeLocalJsonPath = resolveOptionalRepoPath(this.config.MARKET_DATA_UNIVERSE_LOCAL_JSON_PATH);
    this.schwabTokenPath = resolveRepoPath(this.config.SCHWAB_TOKEN_PATH);
    this.schwabStreamerTokenPath = resolveRepoPath(this.config.SCHWAB_STREAMER_TOKEN_PATH);
    const streamerSharedStatePath = resolveRepoPath(this.config.SCHWAB_STREAMER_SHARED_STATE_PATH);
    this.universeManager = new UniverseArtifactManager({
      cacheDir: this.cacheDir,
      sourceLadder: this.universeSourceLadder,
      remoteJsonUrl: this.universeRemoteJsonUrl,
      localJsonPath: this.universeLocalJsonPath,
      logger: this.logger,
      fetchJson: this.fetchJson.bind(this),
    });
    this.coinMarketCap = new CoinMarketCapService({
      config: this.config,
      cacheDir: this.cacheDir,
      logger: this.logger,
      fetchJson: this.fetchJson.bind(this),
    });
    this.schwabRestClient = new SchwabRestClient({
      config: this.config,
      logger: this.logger,
      tokenPath: this.schwabTokenPath,
      providerMetrics: this.providerMetrics,
      fetchResponse: this.fetchResponse.bind(this),
      fetchJson: this.fetchJson.bind(this),
    });
    this.schwabStreamerClient = new SchwabRestClient({
      config: this.buildStreamerSchwabConfig(),
      logger: this.logger,
      tokenPath: this.schwabStreamerTokenPath,
      providerMetrics: this.streamerProviderMetrics,
      fetchResponse: this.fetchResponse.bind(this),
      fetchJson: this.fetchJson.bind(this),
    });
    this.streamerRuntime = new SchwabStreamerRuntime({
      config: {
        ...this.config,
        SCHWAB_STREAMER_SHARED_STATE_PATH: streamerSharedStatePath,
      },
      logger: this.logger,
      providerMetrics: this.providerMetrics,
      credentialsConfigured: () => this.isSchwabStreamerConfigured(),
      accessTokenProvider: () => this.schwabStreamerClient.getAccessToken(),
      preferencesProvider: () => this.fetchSchwabStreamerPreferences(),
      websocketFactory: config.websocketFactory,
    });
    const alpacaClient = new AlpacaClient({
      config: this.config,
      fetchJson: this.fetchJson.bind(this),
    });
    this.providerChain = new ProviderChain({
      coinMarketCap: this.coinMarketCap,
      schwabRestClient: this.schwabRestClient,
      alpacaClient,
      streamerRuntime: this.streamerRuntime,
      providerMetrics: this.providerMetrics,
    });
    this.queryRoutes = new MarketDataQueryRoutes({
      providerChain: this.providerChain,
      ensureRuntimeReady: () => this.ensureRuntimeReady(),
      toErrorRoute: this.toErrorRoute.bind(this),
      toBatchRouteResult: this.toBatchRouteResult.bind(this),
    });
    this.supportRoutes = new MarketDataSupportRoutes({
      cacheDir: this.cacheDir,
      coinMarketCap: this.coinMarketCap,
      universeManager: this.universeManager,
      onUniverseArtifactLoaded: (updatedAt) => {
        this.providerMetrics.lastSuccessfulUniverseRefreshAt = updatedAt;
      },
      buildRiskPayload: this.buildRiskPayload.bind(this),
      toErrorRoute: this.toErrorRoute.bind(this),
    });
    this.authRoutes = new SchwabAuthRoutes({
      redirectUrl: this.config.SCHWAB_REDIRECT_URL,
      tokenPath: this.schwabTokenPath,
      schwabRestClient: this.schwabRestClient,
      getPendingState: () => this.pendingSchwabAuthState,
      setPendingState: (state) => {
        this.pendingSchwabAuthState = state;
      },
    });
    this.streamerAuthRoutes = new SchwabAuthRoutes({
      redirectUrl: this.config.SCHWAB_REDIRECT_URL,
      tokenPath: this.schwabStreamerTokenPath,
      schwabRestClient: this.schwabStreamerClient,
      getPendingState: () => this.pendingSchwabStreamerAuthState,
      setPendingState: (state) => {
        this.pendingSchwabStreamerAuthState = state;
      },
    });
    this.governanceReporter = new MarketDataGovernanceReporter({
      fetchImpl: this.fetchImpl,
      logger: this.logger,
    });
    this.adminRoutes = new MarketDataAdminRoutes({
      cacheDir: this.cacheDir,
      universeSourceLadder: this.universeSourceLadder,
      providerMetrics: this.providerMetrics,
      universeManager: this.universeManager,
      streamerRuntime: this.streamerRuntime,
      schwabRestClient: this.schwabRestClient,
      governanceReporter: this.governanceReporter,
      checkHealth: this.checkHealth.bind(this),
      ensureRuntimeReady: this.ensureRuntimeReady.bind(this),
      enforceStreamerFailurePolicy: this.enforceStreamerFailurePolicy.bind(this),
      toErrorRoute: this.toErrorRoute.bind(this),
    });
  }

  async checkHealth(): Promise<Record<string, unknown>> {
    await this.ensureRuntimeReady();
    await this.enforceStreamerFailurePolicy();
    return buildHealthReport({
      coinMarketCapConfigured: this.coinMarketCap.isConfigured(),
      schwabConfigured: this.isSchwabConfigured(),
      fredConfigured: Boolean(this.config.FRED_API_KEY),
      streamerRuntime: this.streamerRuntime,
      providerMetrics: this.providerMetrics,
      universeSourceLadder: this.universeSourceLadder,
      universeRemoteJsonUrl: this.universeRemoteJsonUrl,
      universeLocalJsonPath: this.universeLocalJsonPath,
    });
  }

  async startup(): Promise<void> {
    await this.streamerRuntime.startup();
  }

  async shutdown(): Promise<void> {
    await this.streamerRuntime.shutdown();
  }

  async handleSchwabAuthUrl(): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    return this.authRoutes.handleAuthUrl();
  }

  async handleSchwabAuthCallback(request: Request): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    const url = new URL(request.url);
    const state = (url.searchParams.get("state") ?? "").trim();
    if (state && this.streamerAuthRoutes.canHandleState(state)) {
      return this.streamerAuthRoutes.handleAuthCallback(request);
    }
    return this.authRoutes.handleAuthCallback(request);
  }

  async handleSchwabAuthStatus(): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    return this.authRoutes.handleAuthStatus();
  }

  async handleSchwabStreamerAuthUrl(): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    return this.streamerAuthRoutes.handleAuthUrl();
  }

  async handleSchwabStreamerAuthStatus(): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    return this.streamerAuthRoutes.handleAuthStatus();
  }

  async handleHistory(request: Request, rawSymbol: string, compareWith?: string): Promise<MarketDataRouteResult<MarketDataHistory>> {
    return this.queryRoutes.handleHistory(request, rawSymbol, compareWith);
  }

  async handleQuote(_request: Request, rawSymbol: string, compareWith?: string): Promise<MarketDataRouteResult<MarketDataQuote>> {
    return this.queryRoutes.handleQuote(_request, rawSymbol, compareWith);
  }

  async handleQuoteBatch(request: Request): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    return this.queryRoutes.handleQuoteBatch(request);
  }

  async handleSnapshot(
    _request: Request,
    rawSymbol: string,
    compareWith?: string,
  ): Promise<MarketDataRouteResult<MarketDataSnapshot>> {
    return this.queryRoutes.handleSnapshot(_request, rawSymbol, compareWith);
  }

  async handleHistoryBatch(request: Request): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    return this.queryRoutes.handleHistoryBatch(request);
  }

  async handleFundamentals(
    request: Request,
    rawSymbol: string,
    compareWith?: string,
  ): Promise<MarketDataRouteResult<MarketDataGenericPayload>> {
    return this.queryRoutes.handleFundamentals(request, rawSymbol, compareWith);
  }

  async handleMetadata(
    _request: Request,
    rawSymbol: string,
    compareWith?: string,
  ): Promise<MarketDataRouteResult<MarketDataGenericPayload>> {
    return this.queryRoutes.handleMetadata(_request, rawSymbol, compareWith);
  }

  async handleCryptoRefresh(request: Request): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    return this.supportRoutes.handleCryptoRefresh(request);
  }

  async handleNews(
    _request: Request,
    rawSymbol: string,
    compareWith?: string,
  ): Promise<MarketDataRouteResult<MarketDataGenericPayload>> {
    return this.queryRoutes.handleNews(_request, rawSymbol, compareWith);
  }

  async handleUniverseBase(): Promise<MarketDataRouteResult<MarketDataUniverse>> {
    return this.supportRoutes.handleUniverseBase();
  }

  async handleUniverseRefresh(): Promise<MarketDataRouteResult<MarketDataUniverse>> {
    return this.supportRoutes.handleUniverseRefresh();
  }

  async handleRiskHistory(request: Request): Promise<MarketDataRouteResult<MarketDataRiskHistory>> {
    await this.ensureRuntimeReady();
    return this.supportRoutes.handleRiskHistory(request);
  }

  async handleRiskSnapshot(): Promise<MarketDataRouteResult<MarketDataRiskSnapshot>> {
    await this.ensureRuntimeReady();
    return this.supportRoutes.handleRiskSnapshot();
  }

  async handleOps(): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    return this.adminRoutes.handleOps();
  }

  async handleReady(): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    return this.adminRoutes.handleReady();
  }

  async handleUniverseAudit(request: Request): Promise<MarketDataRouteResult<Record<string, unknown>>> {
    return this.supportRoutes.handleUniverseAudit(request);
  }

  private isSchwabConfigured(): boolean {
    return this.schwabRestClient.isConfigured();
  }

  private isSchwabStreamerConfigured(): boolean {
    return this.schwabStreamerClient.isConfigured();
  }

  private async fetchSchwabStreamerPreferences(): Promise<SchwabStreamerPreferences> {
    return this.schwabStreamerClient.fetchStreamerPreferences();
  }

  private async enforceStreamerFailurePolicy(): Promise<void> {
    await this.streamerRuntime.enforceFailurePolicy();
  }

  private async ensureRuntimeReady(): Promise<void> {
    await this.streamerRuntime.startup();
  }

  private buildStreamerSchwabConfig(): AppConfig {
    return {
      ...this.config,
      SCHWAB_CLIENT_ID: this.config.SCHWAB_CLIENT_STREAMER_ID.trim() || this.config.SCHWAB_CLIENT_ID,
      SCHWAB_CLIENT_SECRET: this.config.SCHWAB_CLIENT_STREAMER_SECRET.trim() || this.config.SCHWAB_CLIENT_SECRET,
      SCHWAB_REFRESH_TOKEN: this.config.SCHWAB_STREAMER_REFRESH_TOKEN.trim() || this.config.SCHWAB_REFRESH_TOKEN,
      SCHWAB_TOKEN_PATH: this.config.SCHWAB_STREAMER_TOKEN_PATH,
    };
  }

  private async loadOrRefreshUniverseArtifact(forceRefresh: boolean): Promise<MarketDataUniverse> {
    const payload = await this.universeManager.loadOrRefreshArtifact(forceRefresh);
    this.providerMetrics.lastSuccessfulUniverseRefreshAt = payload.updatedAt;
    return payload;
  }

  private async buildRiskPayload(days: number): Promise<RiskPayloadResult> {
    return buildRiskPayload({
      days,
      fredApiKey: this.config.FRED_API_KEY,
      fetchSchwabHistory: (symbol, period, interval) => this.schwabRestClient.fetchHistory(symbol, period, interval),
      fetchJson: this.fetchJson.bind(this),
      fetchResponse: this.fetchResponse.bind(this),
    });
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

  private toBatchRouteResult(items: Array<Record<string, unknown>>): MarketDataRouteResult<Record<string, unknown>> {
    const successCount = items.filter((item) => String(item.status ?? "") !== "error").length;
    const status = successCount === items.length ? "ok" : successCount > 0 ? "degraded" : "error";
    const declaredModes: MarketDataProviderMode[] = Array.from(
      new Set(
        items
          .map((item) => (typeof item.providerMode === "string" ? (item.providerMode as MarketDataProviderMode) : null))
          .filter((mode): mode is MarketDataProviderMode => Boolean(mode)),
      ),
    );
    const fallbackEngaged = items.some((item) => Boolean(item.fallbackEngaged));
    const providerMode: MarketDataProviderMode =
      declaredModes.length === 1
        ? declaredModes[0]
        : declaredModes.length > 1
          ? "multi_mode"
          : "unavailable";
    const providerModeReason =
      providerMode === "multi_mode"
        ? "Batch response contains more than one provider mode across its items."
        : typeof items.find((item) => item.providerMode === providerMode)?.providerModeReason === "string"
          ? String(items.find((item) => item.providerMode === providerMode)?.providerModeReason)
          : successCount > 0
            ? "Batch response produced at least one successful provider mode."
            : "Batch response did not produce a successful provider mode.";
    return {
      status: successCount > 0 ? 200 : 503,
      body: {
        source: "service",
        status,
        degradedReason: successCount === items.length ? null : `${items.length - successCount} batch item(s) failed`,
        stalenessSeconds: 0,
        providerMode,
        fallbackEngaged,
        providerModeReason,
        data: { items },
      },
    };
  }

  private toErrorRoute<T>(error: unknown, data: T): MarketDataRouteResult<T> {
    return {
      status: 503,
      body: {
        source: "service",
        status: "error",
        degradedReason: summarizeError(error),
        stalenessSeconds: null,
        providerMode: "unavailable",
        fallbackEngaged: false,
        providerModeReason: "Route failed before a provider mode could be declared.",
        data,
      },
    };
  }
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

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
