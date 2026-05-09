import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../config.js";
import { mapSchwabPeriod } from "../market-data/history-utils.js";
import { registerMarketDataRoutes } from "../market-data/index.js";
import { MarketDataService } from "../market-data/service.js";
import { normalizeMarketSymbol } from "../market-data/route-utils.js";
import { SchwabStreamerSession, type WebSocketLike } from "../market-data/streamer.js";

const TEST_TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "market-data-tests-"));

const TEST_CONFIG: AppConfig = {
  PORT: 3033,
  MARKET_DATA_CACHE_DIR: path.join(TEST_TEMP_ROOT, "cache"),
  MARKET_DATA_REQUEST_TIMEOUT_MS: 30_000,
  MARKET_DATA_UNIVERSE_SOURCE_LADDER: "local_json",
  MARKET_DATA_UNIVERSE_REMOTE_JSON_URL: "",
  MARKET_DATA_UNIVERSE_LOCAL_JSON_PATH: "config/universe/sp500-constituents.json",
  MARKET_DATA_SCHWAB_FAILURE_THRESHOLD: 3,
  MARKET_DATA_SCHWAB_COOLDOWN_MS: 20_000,
  COINMARKETCAP_API_KEY: "cmc-key",
  COINMARKETCAP_API_BASE_URL: "https://pro-api.coinmarketcap.com",
  SCHWAB_CLIENT_ID: "client",
  SCHWAB_CLIENT_SECRET: "secret",
  SCHWAB_REFRESH_TOKEN: "refresh",
  SCHWAB_CLIENT_STREAMER_ID: "streamer-client",
  SCHWAB_CLIENT_STREAMER_SECRET: "streamer-secret",
  SCHWAB_STREAMER_REFRESH_TOKEN: "",
  SCHWAB_AUTH_URL: "https://api.schwabapi.com/v1/oauth/authorize",
  SCHWAB_REDIRECT_URL: "https://127.0.0.1:8182/auth/schwab/callback",
  SCHWAB_TOKEN_PATH: path.join(TEST_TEMP_ROOT, "schwab-token.json"),
  SCHWAB_STREAMER_TOKEN_PATH: path.join(TEST_TEMP_ROOT, "schwab-streamer-token.json"),
  SCHWAB_API_BASE_URL: "https://api.schwabapi.com",
  SCHWAB_TOKEN_URL: "https://api.schwabapi.com/v1/oauth/token",
  SCHWAB_USER_PREFERENCES_URL: "https://api.schwabapi.com/trader/v1/userPreference",
  SCHWAB_STREAMER_ENABLED: "1",
  SCHWAB_STREAMER_ROLE: "leader",
  SCHWAB_STREAMER_PG_LOCK_KEY: 814021,
  SCHWAB_STREAMER_SHARED_STATE_BACKEND: "file",
  SCHWAB_STREAMER_SHARED_STATE_PATH: path.join(TEST_TEMP_ROOT, "test-schwab-streamer-state.json"),
  SCHWAB_STREAMER_CONNECT_TIMEOUT_MS: 1_000,
  SCHWAB_STREAMER_QUOTE_TTL_MS: 15_000,
  SCHWAB_STREAMER_AFTER_HOURS_QUOTE_TTL_MS: 259_200_000,
  SCHWAB_STREAMER_SYMBOL_SOFT_CAP: 250,
  SCHWAB_STREAMER_CACHE_SOFT_CAP: 500,
  SCHWAB_STREAMER_EQUITY_FIELDS: "0,1,2,3,8,19,20,32,34,42",
  SCHWAB_STREAMER_ACCOUNT_ACTIVITY_ENABLED: "1",
  SCHWAB_STREAMER_RECONNECT_JITTER_MS: 0,
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
  APPLE_HEALTH_DATA_PATH: path.join(TEST_TEMP_ROOT, "apple-health", "latest.json"),
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
  POLYMARKET_PINNED_MARKETS_PATH: path.join(TEST_TEMP_ROOT, "pinned-markets.json"),
  ALPACA_KEYS_PATH: "",
  ALPACA_TARGET_ENVIRONMENT: "live",
  CORTANA_DATABASE_URL: "postgres://localhost:5432/cortana?sslmode=disable",
  EXTERNAL_SERVICE_TLS_PORT: 8182,
  EXTERNAL_SERVICE_TLS_CERT_PATH: "",
  EXTERNAL_SERVICE_TLS_KEY_PATH: "",
};

class FakeWebSocket implements WebSocketLike {
  static createdCount = 0;
  static sentRequests: Array<{ service: string; command: string; keys?: string }> = [];
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;

  constructor() {
    FakeWebSocket.createdCount += 1;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.({});
    });
  }

  send(data: string): void {
    const payload = JSON.parse(data) as {
      requests?: Array<{ requestid?: string; service: string; command: string; parameters?: { keys?: string; fields?: string } }>;
    };
    const request = payload.requests?.[0];
    if (!request) {
      return;
    }
    FakeWebSocket.sentRequests.push({ service: request.service, command: request.command, keys: request.parameters?.keys });
    if (request.service === "ADMIN" && request.command === "LOGIN") {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            response: [
              {
                service: "ADMIN",
                command: "LOGIN",
                requestid: "1",
                content: { code: 0, msg: "server=test;status=PN" },
              },
            ],
          }),
        });
      });
      return;
    }
    if (request.service === "LEVELONE_EQUITIES" && (request.command === "SUBS" || request.command === "ADD")) {
      const firstKey = request.parameters?.keys?.split(",")[0] ?? "AAPL";
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            response: [
              {
                service: "LEVELONE_EQUITIES",
                command: request.command,
                requestid: request.requestid ?? "0",
                content: { code: 0, msg: `${request.command} command succeeded` },
              },
            ],
          }),
        });
      });
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            data: [
              {
                service: "LEVELONE_EQUITIES",
                timestamp: 1_710_000_100_000,
                command: request.command,
                content: [
                  {
                    key: firstKey,
                    "3": 201.5,
                    "34": 1_710_000_100_000,
                  },
                ],
              },
            ],
          }),
        });
      });
      return;
    }
    if (request.service === "LEVELONE_FUTURES" && (request.command === "SUBS" || request.command === "ADD")) {
      const firstKey = request.parameters?.keys?.split(",")[0] ?? "/ES";
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            response: [
              {
                service: "LEVELONE_FUTURES",
                command: request.command,
                requestid: request.requestid ?? "0",
                content: { code: 0, msg: `${request.command} command succeeded` },
              },
            ],
          }),
        });
      });
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            data: [
              {
                service: "LEVELONE_FUTURES",
                timestamp: 1_710_000_140_000,
                command: request.command,
                content: [
                  {
                    key: firstKey,
                    "3": 5_200.25,
                    "34": 1_710_000_140_000,
                  },
                ],
              },
            ],
          }),
        });
      });
      return;
    }
    if (request.service === "LEVELONE_EQUITIES" && request.command === "UNSUBS") {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            response: [
              {
                service: "LEVELONE_EQUITIES",
                command: request.command,
                requestid: request.requestid ?? "0",
                content: { code: 0, msg: "UNSUBS command succeeded" },
              },
            ],
          }),
        });
      });
      return;
    }
    if (request.service === "CHART_EQUITY" && (request.command === "SUBS" || request.command === "ADD")) {
      const firstKey = request.parameters?.keys?.split(",")[0] ?? "AAPL";
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            response: [
              {
                service: "CHART_EQUITY",
                command: request.command,
                requestid: request.requestid ?? "0",
                content: { code: 0, msg: `${request.command} command succeeded` },
              },
            ],
          }),
        });
      });
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            data: [
              {
                service: "CHART_EQUITY",
                timestamp: 1_710_000_120_000,
                command: request.command,
                content: [
                  {
                    "0": firstKey,
                    "1": 200.9,
                    "2": 202.1,
                    "3": 200.4,
                    "4": 201.7,
                    "5": 150000,
                    "6": 123,
                    "7": 1_710_000_120_000,
                  },
                ],
              },
            ],
          }),
        });
      });
      return;
    }
    if (request.service === "ACCT_ACTIVITY" && request.command === "SUBS") {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            response: [
              {
                service: "ACCT_ACTIVITY",
                command: request.command,
                requestid: request.requestid ?? "0",
                content: { code: 0, msg: "SUBS command succeeded" },
              },
            ],
          }),
        });
      });
      return;
    }
    if (request.service === "ACCT_ACTIVITY" && request.command === "UNSUBS") {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            response: [
              {
                service: "ACCT_ACTIVITY",
                command: request.command,
                requestid: request.requestid ?? "0",
                content: { code: 0, msg: "UNSUBS command succeeded" },
              },
            ],
          }),
        });
      });
      return;
    }
    if (
      (request.service === "LEVELONE_EQUITIES" || request.service === "LEVELONE_FUTURES" || request.service === "CHART_EQUITY") &&
      request.command === "VIEW"
    ) {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            response: [
              {
                service: request.service,
                command: request.command,
                requestid: request.requestid ?? "0",
                content: { code: 0, msg: "VIEW command succeeded" },
              },
            ],
          }),
        });
      });
    }
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

class ActivityWebSocket extends FakeWebSocket {
  override send(data: string): void {
    const payload = JSON.parse(data) as {
      requests?: Array<{ requestid?: string; service: string; command: string; parameters?: { keys?: string; fields?: string } }>;
    };
    const request = payload.requests?.[0];
    super.send(data);
    if (request?.service === "ACCT_ACTIVITY" && request.command === "SUBS") {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            data: [
              {
                service: "ACCT_ACTIVITY",
                timestamp: 1_710_000_130_000,
                command: "SUBS",
                content: [
                  {
                    "0": "TRADE",
                    "1": "123456789",
                    "2": "AAPL",
                    "3": "Bought 10 shares",
                    "4": 10,
                    "5": 201.5,
                    "6": 1_710_000_130_000,
                  },
                ],
              },
            ],
          }),
        });
      });
    }
  }
}

class FailureWebSocket extends FakeWebSocket {
  static failureCode: number | null = null;
  static failureMessage = "forced failure";

  override send(data: string): void {
    const payload = JSON.parse(data) as {
      requests?: Array<{ requestid?: string; service: string; command: string; parameters?: { keys?: string; fields?: string } }>;
    };
    const request = payload.requests?.[0];
    if (
      request &&
      request.service !== "ADMIN" &&
      (request.command === "SUBS" || request.command === "ADD" || request.command === "VIEW") &&
      FailureWebSocket.failureCode != null
    ) {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            response: [
              {
                service: request.service,
                command: request.command,
                requestid: request.requestid ?? "0",
                content: { code: FailureWebSocket.failureCode, msg: FailureWebSocket.failureMessage },
              },
            ],
          }),
        });
      });
      return;
    }
    super.send(data);
  }
}

describe("market-data routes", () => {
  it("maps day lookbacks to valid Schwab daily history periods", () => {
    expect(mapSchwabPeriod("90d", "1d")).toMatchObject({
      periodType: "month",
      period: 3,
      frequencyType: "daily",
      frequency: 1,
    });
    expect(mapSchwabPeriod("400d", "1d")).toMatchObject({
      periodType: "year",
      period: 2,
      frequencyType: "daily",
      frequency: 1,
    });
  });

  it("surfaces streamer health metadata after a streamer-backed quote", async () => {
    FakeWebSocket.createdCount = 0;
    FakeWebSocket.sentRequests = [];
    const service = new MarketDataService({
      config: TEST_CONFIG,
      websocketFactory: () => new FakeWebSocket(),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/trader/v1/userPreference")) {
          return new Response(
            JSON.stringify({
              streamerInfo: {
                streamerSocketUrl: "wss://streamer.example.test/ws",
                schwabClientCustomerId: "customer-id",
                schwabClientCorrelId: "correl-id",
                schwabClientChannel: "N9",
                schwabClientFunctionId: "APIAP",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    const quote = await service.handleQuote(new Request("http://localhost/market-data/quote/AAPL"), "AAPL");
    const health = await service.checkHealth();
    const providers = (health.providers ?? {}) as Record<string, unknown>;
    const streamerMeta = (providers.schwabStreamerMeta ?? {}) as Record<string, unknown>;

    expect(quote.body.source).toBe("schwab_streamer");
    expect(streamerMeta.connected).toBe(true);
    expect(streamerMeta.stale).toBe(false);
    expect(streamerMeta.messageRatePerMinute).toBeGreaterThan(0);
    expect(streamerMeta.reconnectFailureStreak).toBe(0);
    expect((streamerMeta.requestedSubscriptions as Record<string, number>).LEVELONE_EQUITIES).toBe(1);
  });

  it("captures a bounded futures quote cache in streamer health and shared state", async () => {
    FakeWebSocket.createdCount = 0;
    FakeWebSocket.sentRequests = [];
    const snapshots: Array<Record<string, unknown>> = [];
    const session = new SchwabStreamerSession({
      logger: {
        log() {},
        printf() {},
        error() {},
      },
      websocketFactory: () => new FakeWebSocket(),
      accessTokenProvider: async () => "access-token",
      preferencesProvider: async () => ({
        streamerSocketUrl: "wss://streamer.example.test/ws",
        schwabClientCustomerId: "customer-id",
        schwabClientCorrelId: "correl-id",
        schwabClientChannel: "N9",
        schwabClientFunctionId: "APIAP",
      }),
      accountActivityEnabled: false,
      stateSink: (state) => {
        snapshots.push(state as unknown as Record<string, unknown>);
      },
    });

    const quote = await session.getFuturesQuote("/ES");
    const health = session.getHealth();
    const latestSnapshot = (snapshots.at(-1) ?? {}) as Record<string, unknown>;
    const recentFuturesQuotes = health.recentFuturesQuotes as unknown as Array<Record<string, unknown>>;
    const storedFuturesQuotes = latestSnapshot.futuresQuotes as Record<string, { quote: Record<string, unknown> }>;

    expect(quote?.symbol).toBe("/ES");
    expect(quote?.rootSymbol).toBe("ES");
    expect(quote?.price).toBe(5200.25);
    expect(recentFuturesQuotes).toHaveLength(1);
    expect(recentFuturesQuotes[0]?.symbol).toBe("/ES");
    expect(recentFuturesQuotes[0]?.rootSymbol).toBe("ES");
    expect(storedFuturesQuotes?.["/ES"]?.quote.symbol).toBe("/ES");
    expect(storedFuturesQuotes?.["/ES"]?.quote.rootSymbol).toBe("ES");

    session.close();
  });

  it("retains stale equity quotes in shared state for the closed-market retention window", async () => {
    FakeWebSocket.createdCount = 0;
    FakeWebSocket.sentRequests = [];
    const snapshots: Array<Record<string, unknown>> = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T20:00:00.000Z"));
    try {
      const session = new SchwabStreamerSession({
        logger: {
          log() {},
          printf() {},
          error() {},
        },
        websocketFactory: () => new FakeWebSocket(),
        accessTokenProvider: async () => "access-token",
        preferencesProvider: async () => ({
          streamerSocketUrl: "wss://streamer.example.test/ws",
          schwabClientCustomerId: "customer-id",
          schwabClientCorrelId: "correl-id",
          schwabClientChannel: "N9",
          schwabClientFunctionId: "APIAP",
        }),
        accountActivityEnabled: false,
        staleCacheRetentionMs: 72 * 60 * 60 * 1000,
        stateSink: (state) => {
          snapshots.push(state as unknown as Record<string, unknown>);
        },
      });

      try {
        const quote = await session.getQuote("SPY");
        expect(quote?.symbol).toBe("SPY");

        await vi.advanceTimersByTimeAsync(20 * 60 * 1000);

        const latestSnapshot = (snapshots.at(-1) ?? {}) as Record<string, unknown>;
        const storedQuotes = latestSnapshot.quotes as Record<string, { quote: Record<string, unknown> }>;
        expect(storedQuotes?.SPY?.quote.symbol).toBe("SPY");
      } finally {
        session.close();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("buffers normalized ACCT_ACTIVITY events in streamer health and shared state", async () => {
    FakeWebSocket.createdCount = 0;
    FakeWebSocket.sentRequests = [];
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "market-data-acct-activity-"));
    const sharedStatePath = path.join(tempDir, "streamer-state.json");
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_STREAMER_SHARED_STATE_PATH: sharedStatePath,
      },
      websocketFactory: () => new ActivityWebSocket(),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/trader/v1/userPreference")) {
          return new Response(
            JSON.stringify({
              streamerInfo: {
                streamerSocketUrl: "wss://streamer.example.test/ws",
                schwabClientCustomerId: "customer-id",
                schwabClientCorrelId: "correl-id",
                schwabClientChannel: "N9",
                schwabClientFunctionId: "APIAP",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    await service.handleQuote(new Request("http://localhost/market-data/quote/AAPL"), "AAPL");

    const health = await service.checkHealth();
    const providers = (health.providers ?? {}) as Record<string, unknown>;
    const streamerMeta = (providers.schwabStreamerMeta ?? {}) as Record<string, unknown>;
    const recentEvents = streamerMeta.recentAccountActivityEvents as Array<Record<string, unknown>>;
    const writtenState = JSON.parse(fs.readFileSync(sharedStatePath, "utf8")) as {
      recentAccountActivityEvents: Array<{
        event: { symbol?: string; quantity?: number; eventType?: string };
        receivedAt: string;
      }>;
    };

    expect(recentEvents).toHaveLength(1);
    expect(recentEvents[0]?.service).toBe("ACCT_ACTIVITY");
    expect(recentEvents[0]?.symbol).toBe("AAPL");
    expect(recentEvents[0]?.quantity).toBe(10);
    expect(recentEvents[0]?.eventType).toBe("TRADE");
    expect(writtenState.recentAccountActivityEvents).toHaveLength(1);
    expect(writtenState.recentAccountActivityEvents[0]?.event.symbol).toBe("AAPL");
  });

  it("uses ADD for incremental streamer subscriptions after the initial SUBS", async () => {
    FakeWebSocket.createdCount = 0;
    FakeWebSocket.sentRequests = [];
    const service = new MarketDataService({
      config: TEST_CONFIG,
      websocketFactory: () => new FakeWebSocket(),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/trader/v1/userPreference")) {
          return new Response(
            JSON.stringify({
              streamerInfo: {
                streamerSocketUrl: "wss://streamer.example.test/ws",
                schwabClientCustomerId: "customer-id",
                schwabClientCorrelId: "correl-id",
                schwabClientChannel: "N9",
                schwabClientFunctionId: "APIAP",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    await service.handleQuote(new Request("http://localhost/market-data/quote/AAPL"), "AAPL");
    await service.handleQuote(new Request("http://localhost/market-data/quote/MSFT"), "MSFT");

    const equityCommands = FakeWebSocket.sentRequests
      .filter((request) => request.service === "LEVELONE_EQUITIES")
      .map((request) => `${request.command}:${request.keys ?? ""}`);
    expect(equityCommands).toContain("SUBS:AAPL");
    expect(equityCommands).toContain("ADD:MSFT");
  });

  it("returns schwab-backed quote payload for quote endpoint", async () => {
    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        MARKET_DATA_CACHE_DIR: path.join(TEST_TEMP_ROOT, "crypto-quote-cache"),
        SCHWAB_STREAMER_ENABLED: "0",
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/marketdata/v1/quotes")) {
          return new Response(
            JSON.stringify({
              AAPL: {
                quote: {
                  symbol: "AAPL",
                  lastPrice: 200.12,
                  tradeTimeInLong: 1_710_000_000_000,
                },
                reference: {
                  description: "Apple Inc.",
                  currency: "USD",
                },
                fundamental: {
                  marketCap: 3_000_000_000_000,
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/quote/AAPL");
    const body = (await response.json()) as {
      source: string;
      status: string;
      providerMode: string;
      fallbackEngaged: boolean;
      providerModeReason: string;
      data: { symbol: string; price: number };
    };

    expect(response.status).toBe(200);
    expect(body.source).toBe("schwab");
    expect(body.status).toBe("ok");
    expect(body.providerMode).toBe("schwab_primary");
    expect(body.fallbackEngaged).toBe(false);
    expect(body.providerModeReason).toContain("Schwab");
    expect(body.data.symbol).toBe("AAPL");
    expect(body.data.price).toBe(200.12);
  });

  it("builds a Schwab auth URL with the configured HTTPS callback", async () => {
    const app = new Hono();
    const service = new MarketDataService({
      config: TEST_CONFIG,
      fetchImpl: async () => new Response("not found", { status: 404 }),
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/auth/schwab/url");
    const body = (await response.json()) as { data: { url: string; callbackUrl: string; state: string } };
    const authUrl = new URL(body.data.url);

    expect(response.status).toBe(200);
    expect(body.data.callbackUrl).toBe("https://127.0.0.1:8182/auth/schwab/callback");
    expect(authUrl.origin).toBe("https://api.schwabapi.com");
    expect(authUrl.pathname).toBe("/v1/oauth/authorize");
    expect(authUrl.searchParams.get("client_id")).toBe("client");
    expect(authUrl.searchParams.get("redirect_uri")).toBe("https://127.0.0.1:8182/auth/schwab/callback");
    expect(authUrl.searchParams.get("response_type")).toBe("code");
    expect(authUrl.searchParams.get("state")).toBe(body.data.state);
  });

  it("builds a Schwab streamer auth URL with streamer credentials", async () => {
    const app = new Hono();
    const service = new MarketDataService({
      config: TEST_CONFIG,
      fetchImpl: async () => new Response("not found", { status: 404 }),
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/auth/schwab/streamer/url");
    const body = (await response.json()) as { data: { url: string; callbackUrl: string; state: string; tokenPath: string } };
    const authUrl = new URL(body.data.url);

    expect(response.status).toBe(200);
    expect(body.data.callbackUrl).toBe("https://127.0.0.1:8182/auth/schwab/callback");
    expect(body.data.tokenPath).toBe(TEST_CONFIG.SCHWAB_STREAMER_TOKEN_PATH);
    expect(authUrl.searchParams.get("client_id")).toBe("streamer-client");
    expect(authUrl.searchParams.get("redirect_uri")).toBe("https://127.0.0.1:8182/auth/schwab/callback");
    expect(authUrl.searchParams.get("state")).toBe(body.data.state);
  });

  it("exchanges a Schwab authorization code and persists the refresh token", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "market-data-schwab-auth-"));
    const tokenPath = path.join(tempDir, "schwab-token.json");
    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_REFRESH_TOKEN: "",
        SCHWAB_TOKEN_PATH: tokenPath,
      },
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          expect(String(init?.body)).toContain("grant_type=authorization_code");
          expect(String(init?.body)).toContain("redirect_uri=https%3A%2F%2F127.0.0.1%3A8182%2Fauth%2Fschwab%2Fcallback");
          return new Response(
            JSON.stringify({
              access_token: "oauth-access-token",
              refresh_token: "oauth-refresh-token",
              expires_in: 1800,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const authResponse = await app.request("/auth/schwab/url");
    const authBody = (await authResponse.json()) as { data: { state: string } };

    const callbackResponse = await app.request(
      `/auth/schwab/callback?code=abc123&state=${encodeURIComponent(authBody.data.state)}`,
    );
    const callbackBody = (await callbackResponse.json()) as { data: { hasRefreshToken: boolean; tokenPath: string } };
    const persisted = JSON.parse(fs.readFileSync(tokenPath, "utf8")) as {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    };

    expect(callbackResponse.status).toBe(200);
    expect(callbackBody.data.hasRefreshToken).toBe(true);
    expect(callbackBody.data.tokenPath).toBe(tokenPath);
    expect(persisted.accessToken).toBe("oauth-access-token");
    expect(persisted.refreshToken).toBe("oauth-refresh-token");
    expect(typeof persisted.expiresAt).toBe("number");

    const statusResponse = await app.request("/auth/schwab/status");
    const statusBody = (await statusResponse.json()) as { data: { refreshTokenPresent: boolean; tokenPath: string } };
    expect(statusResponse.status).toBe(200);
    expect(statusBody.data.refreshTokenPresent).toBe(true);
    expect(statusBody.data.tokenPath).toBe(tokenPath);
  });

  it("exchanges a Schwab streamer authorization code and persists the streamer refresh token", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "market-data-schwab-streamer-auth-"));
    const tokenPath = path.join(tempDir, "schwab-streamer-token.json");
    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_STREAMER_REFRESH_TOKEN: "",
        SCHWAB_STREAMER_TOKEN_PATH: tokenPath,
      },
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          expect(String(init?.body)).toContain("grant_type=authorization_code");
          return new Response(
            JSON.stringify({
              access_token: "streamer-oauth-access-token",
              refresh_token: "streamer-oauth-refresh-token",
              expires_in: 1800,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const authResponse = await app.request("/auth/schwab/streamer/url");
    const authBody = (await authResponse.json()) as { data: { state: string } };

    const callbackResponse = await app.request(
      `/auth/schwab/callback?code=streamer123&state=${encodeURIComponent(authBody.data.state)}`,
    );
    const callbackBody = (await callbackResponse.json()) as { data: { hasRefreshToken: boolean; tokenPath: string } };
    const persisted = JSON.parse(fs.readFileSync(tokenPath, "utf8")) as {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    };

    expect(callbackResponse.status).toBe(200);
    expect(callbackBody.data.hasRefreshToken).toBe(true);
    expect(callbackBody.data.tokenPath).toBe(tokenPath);
    expect(persisted.accessToken).toBe("streamer-oauth-access-token");
    expect(persisted.refreshToken).toBe("streamer-oauth-refresh-token");

    const statusResponse = await app.request("/auth/schwab/streamer/status");
    const statusBody = (await statusResponse.json()) as { data: { refreshTokenPresent: boolean; tokenPath: string } };
    expect(statusResponse.status).toBe(200);
    expect(statusBody.data.refreshTokenPresent).toBe(true);
    expect(statusBody.data.tokenPath).toBe(tokenPath);
  });

  it("rejects Schwab auth callbacks when the state does not match", async () => {
    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_REFRESH_TOKEN: "",
      },
      fetchImpl: async () => new Response("not found", { status: 404 }),
    });
    registerMarketDataRoutes(app, service);

    await app.request("/auth/schwab/url");
    const response = await app.request("/auth/schwab/callback?code=abc123&state=wrong-state");
    const body = (await response.json()) as { source: string; status: string };

    expect(response.status).toBe(400);
    expect(body.source).toBe("service");
    expect(body.status).toBe("error");
  });

  it("marks ready=false when Schwab refresh token is rejected", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "market-data-token-reject-"));
    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_STREAMER_ENABLED: "0",
        SCHWAB_TOKEN_PATH: path.join(tempDir, "missing-token.json"),
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const historyResponse = await app.request("/market-data/history/AAPL?period=1mo");
    const historyBody = (await historyResponse.json()) as { source: string; status: string };
    expect(historyResponse.status).toBe(503);
    expect(historyBody.source).toBe("service");
    expect(historyBody.status).toBe("error");

    const readyResponse = await app.request("/market-data/ready");
    const readyBody = (await readyResponse.json()) as { data: { ready: boolean; operatorState: string; operatorAction: string } };
    expect(readyResponse.status).toBe(503);
    expect(readyBody.data.ready).toBe(false);
    expect(readyBody.data.operatorState).toBe("human_action_required");
    expect(readyBody.data.operatorAction).toContain("refresh token");
  });

  it("prefers streamer-backed schwab quotes when the session is available", async () => {
    const app = new Hono();
    const service = new MarketDataService({
      config: TEST_CONFIG,
      websocketFactory: () => new FakeWebSocket(),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(
            JSON.stringify({ access_token: "access-token", expires_in: 1800 }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/trader/v1/userPreference")) {
          return new Response(
            JSON.stringify({
              streamerInfo: {
                streamerSocketUrl: "wss://streamer.example.test/ws",
                schwabClientCustomerId: "customer-id",
                schwabClientCorrelId: "correl-id",
                schwabClientChannel: "N9",
                schwabClientFunctionId: "APIAP",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/quote/AAPL");
    const body = (await response.json()) as { source: string; data: { price?: number; symbol: string } };

    expect(response.status).toBe(200);
    expect(body.source).toBe("schwab_streamer");
    expect(body.data.symbol).toBe("AAPL");
    expect(body.data.price).toBe(201.5);
  });

  it("serves direct crypto quotes from CoinMarketCap", async () => {
    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        MARKET_DATA_CACHE_DIR: path.join(TEST_TEMP_ROOT, "crypto-snapshot-cache"),
        SCHWAB_STREAMER_ENABLED: "0",
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/v1/cryptocurrency/quotes/latest?symbol=BTC")) {
          return new Response(
            JSON.stringify({
              status: { error_code: 0, error_message: null },
              data: {
                BTC: {
                  id: 1,
                  name: "Bitcoin",
                  symbol: "BTC",
                  slug: "bitcoin",
                  last_updated: "2026-03-23T22:40:00.000Z",
                  quote: {
                    USD: {
                      price: 70652.75,
                      volume_24h: 51632763594.22,
                      percent_change_24h: 3.54,
                      last_updated: "2026-03-23T22:40:00.000Z",
                    },
                  },
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/quote/BTC-USD");
    const body = (await response.json()) as { source: string; data: { symbol: string; price?: number; currency?: string } };

    expect(response.status).toBe(200);
    expect(body.source).toBe("coinmarketcap");
    expect(body.data.symbol).toBe("BTC-USD");
    expect(body.data.price).toBe(70652.75);
    expect(body.data.currency).toBe("USD");
  });

  it("enriches crypto snapshots from CoinMarketCap quote and info endpoints", async () => {
    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        MARKET_DATA_CACHE_DIR: path.join(TEST_TEMP_ROOT, "crypto-history-unavailable-cache"),
        SCHWAB_STREAMER_ENABLED: "0",
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/v1/cryptocurrency/quotes/latest?symbol=BTC")) {
          return new Response(
            JSON.stringify({
              status: { error_code: 0, error_message: null },
              data: {
                BTC: {
                  id: 1,
                  name: "Bitcoin",
                  symbol: "BTC",
                  slug: "bitcoin",
                  category: "coin",
                  cmc_rank: 1,
                  circulating_supply: 20003043,
                  total_supply: 20003043,
                  max_supply: 21000000,
                  last_updated: "2026-03-23T22:40:00.000Z",
                  quote: {
                    USD: {
                      price: 70652.75,
                      volume_24h: 51632763594.22,
                      market_cap: 1413269989028.65,
                      fully_diluted_market_cap: 1483707742347.09,
                      percent_change_24h: 3.54,
                      percent_change_7d: -5.42,
                      last_updated: "2026-03-23T22:40:00.000Z",
                    },
                  },
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/v2/cryptocurrency/info?symbol=BTC")) {
          return new Response(
            JSON.stringify({
              status: { error_code: 0, error_message: null },
              data: {
                BTC: [
                  {
                    id: 1,
                    name: "Bitcoin",
                    symbol: "BTC",
                    slug: "bitcoin",
                    category: "coin",
                    description: "Bitcoin description",
                    logo: "https://example.test/btc.png",
                    urls: {
                      website: ["https://bitcoin.org/"],
                      technical_doc: ["https://bitcoin.org/bitcoin.pdf"],
                    },
                    platform: null,
                  },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/snapshot/BTC-USD");
    const body = (await response.json()) as {
      source: string;
      data: {
        quote?: { price?: number };
        metadata?: { description?: string; website?: string };
        fundamentals?: { market_cap?: number; rank?: number };
      };
    };

    expect(response.status).toBe(200);
    expect(body.source).toBe("coinmarketcap");
    expect(body.data.quote?.price).toBe(70652.75);
    expect(body.data.metadata?.description).toBe("Bitcoin description");
    expect(body.data.metadata?.website).toBe("https://bitcoin.org/");
    expect(body.data.fundamentals?.market_cap).toBe(1413269989028.65);
    expect(body.data.fundamentals?.rank).toBe(1);
  });

  it("surfaces a clear error when CoinMarketCap historical quotes are unavailable on the plan", async () => {
    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_STREAMER_ENABLED: "0",
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/v1/cryptocurrency/quotes/latest?symbol=BTC")) {
          return new Response(
            JSON.stringify({
              status: { error_code: 0, error_message: null },
              data: {
                BTC: {
                  id: 1,
                  name: "Bitcoin",
                  symbol: "BTC",
                  slug: "bitcoin",
                  quote: { USD: { price: 70652.75, last_updated: "2026-03-23T22:40:00.000Z" } },
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/v1/cryptocurrency/quotes/historical?id=1")) {
          return new Response(
            JSON.stringify({
              status: { error_code: 1006, error_message: "Your API Key subscription plan doesn't support this endpoint." },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/history/BTC-USD?period=6mo");
    const body = (await response.json()) as { degradedReason?: string; data: { rows: unknown[] } };

    expect(response.status).toBe(503);
    expect(body.degradedReason).toContain("CoinMarketCap historical quotes are not available");
    expect(body.data.rows).toEqual([]);
  });

  it("refreshes daily crypto cache for BTC and serves cached daily history", async () => {
    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        MARKET_DATA_CACHE_DIR: path.join(TEST_TEMP_ROOT, "crypto-refresh-cache"),
        SCHWAB_STREAMER_ENABLED: "0",
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/v1/cryptocurrency/quotes/latest?symbol=BTC")) {
          return new Response(
            JSON.stringify({
              status: { error_code: 0, error_message: null },
              data: {
                BTC: {
                  id: 1,
                  name: "Bitcoin",
                  symbol: "BTC",
                  slug: "bitcoin",
                  quote: {
                    USD: {
                      price: 70000,
                      volume_24h: 123456,
                      percent_change_24h: 2.5,
                      last_updated: "2026-03-23T22:40:00.000Z",
                    },
                  },
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/v2/cryptocurrency/info?symbol=BTC")) {
          return new Response(
            JSON.stringify({
              status: { error_code: 0, error_message: null },
              data: { BTC: [{ id: 1, slug: "bitcoin", description: "Bitcoin", urls: { website: ["https://bitcoin.org/"] } }] },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const refreshResponse = await app.request("/market-data/crypto/refresh?symbols=BTC", { method: "POST" });
    const refreshBody = (await refreshResponse.json()) as { data: { refreshed: Array<{ symbol: string; rowCount: number; status: string }> } };
    expect(refreshResponse.status).toBe(200);
    expect(refreshBody.data.refreshed[0]).toMatchObject({ symbol: "BTC", status: "refreshed", rowCount: 1 });

    const historyResponse = await app.request("/market-data/history/BTC-USD?period=6mo");
    const historyBody = (await historyResponse.json()) as { source: string; data: { rows: Array<{ close: number }> } };
    expect(historyResponse.status).toBe(200);
    expect(historyBody.source).toBe("coinmarketcap");
    expect(historyBody.data.rows).toHaveLength(1);
    expect(historyBody.data.rows[0]?.close).toBe(70000);
  });

  it("skips same-day crypto refresh unless force=1", async () => {
    const refreshedAt = new Date().toISOString();
    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        MARKET_DATA_CACHE_DIR: path.join(TEST_TEMP_ROOT, "crypto-refresh-skip-cache"),
        SCHWAB_STREAMER_ENABLED: "0",
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/v1/cryptocurrency/quotes/latest?symbol=ETH")) {
          return new Response(
            JSON.stringify({
              status: { error_code: 0, error_message: null },
              data: {
                ETH: {
                  id: 1027,
                  name: "Ethereum",
                  symbol: "ETH",
                  slug: "ethereum",
                  quote: {
                    USD: {
                      price: 3500,
                      volume_24h: 654321,
                      percent_change_24h: 1.5,
                      last_updated: refreshedAt,
                    },
                  },
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/v2/cryptocurrency/info?symbol=ETH")) {
          return new Response(
            JSON.stringify({
              status: { error_code: 0, error_message: null },
              data: { ETH: [{ id: 1027, slug: "ethereum", description: "Ethereum", urls: { website: ["https://ethereum.org/"] } }] },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const first = await app.request("/market-data/crypto/refresh?symbols=ETH", { method: "POST" });
    const second = await app.request("/market-data/crypto/refresh?symbols=ETH", { method: "POST" });
    const firstBody = (await first.json()) as { data: { refreshed: Array<{ status: string }> } };
    const secondBody = (await second.json()) as { data: { refreshed: Array<{ status: string }> } };

    expect(firstBody.data.refreshed[0]?.status).toBe("refreshed");
    expect(secondBody.data.refreshed[0]?.status).toBe("skipped");
  });

  it("enriches snapshot payloads with streamer-backed chart equity data", async () => {
    const app = new Hono();
    const service = new MarketDataService({
      config: TEST_CONFIG,
      websocketFactory: () => new FakeWebSocket(),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/trader/v1/userPreference")) {
          return new Response(
            JSON.stringify({
              streamerInfo: {
                streamerSocketUrl: "wss://streamer.example.test/ws",
                schwabClientCustomerId: "customer-id",
                schwabClientCorrelId: "correl-id",
                schwabClientChannel: "N9",
                schwabClientFunctionId: "APIAP",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/marketdata/v1/quotes")) {
          return new Response(
            JSON.stringify({
              AAPL: {
                quote: {
                  symbol: "AAPL",
                  lastPrice: 200.12,
                  tradeTimeInLong: 1_710_000_000_000,
                },
                reference: {
                  description: "Apple Inc.",
                  sector: "Technology",
                  industry: "Consumer Electronics",
                  currency: "USD",
                },
                fundamental: {
                  floatShares: 15_500_000_000,
                  sharesOutstanding: 15_700_000_000,
                  marketCap: 3_100_000_000_000,
                  beta: 1.12,
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/snapshot/AAPL");
    const body = (await response.json()) as {
      source: string;
      data: { chartEquity?: { close?: number; symbol?: string } };
    };

    expect(response.status).toBe(200);
    expect(body.source).toBe("schwab_streamer");
    expect(body.data.chartEquity?.symbol).toBe("AAPL");
    expect(body.data.chartEquity?.close).toBe(201.7);
  });

  it("uses Schwab fundamentals as the only primary source", async () => {
    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_STREAMER_ENABLED: "0",
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/marketdata/v1/quotes")) {
          return new Response(
            JSON.stringify({
              AAPL: {
                quote: {
                  symbol: "AAPL",
                  lastPrice: 201.5,
                  tradeTimeInLong: 1_710_000_000_000,
                },
                reference: {
                  description: "Apple Inc.",
                  sector: "Technology",
                  industry: "Consumer Electronics",
                },
                fundamental: {
                  floatShares: 15_500_000_000,
                  sharesOutstanding: 15_700_000_000,
                  marketCap: 3_100_000_000_000,
                  beta: 1.12,
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/fundamentals/AAPL");
    const body = (await response.json()) as { source: string; data: { payload: Record<string, unknown> } };

    expect(response.status).toBe(200);
    expect(body.source).toBe("schwab");
    expect(body.data.payload.float_shares).toBe(15_500_000_000);
    expect(body.data.payload.sector).toBe("Technology");
    expect(body.data.payload.market_cap).toBe(3_100_000_000_000);
  });

  it("refreshes universe artifact from the bundled local S&P source", async () => {
    const service = new MarketDataService({ config: TEST_CONFIG });
    const result = await service.handleUniverseRefresh();

    expect(result.status).toBe(200);
    expect(result.body.data.source).toBe("local_json");
    expect(result.body.data.symbols.length).toBeGreaterThan(500);
  });

  it("prefers a configured remote universe JSON source", async () => {
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_CLIENT_ID: "",
        SCHWAB_CLIENT_SECRET: "",
        SCHWAB_REFRESH_TOKEN: "",
        MARKET_DATA_UNIVERSE_SOURCE_LADDER: "remote_json,local_json",
        MARKET_DATA_UNIVERSE_REMOTE_JSON_URL: "https://example.test/universe.json",
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url === "https://example.test/universe.json") {
          return new Response(JSON.stringify({ symbols: ["msft", "brk.b", "spy"] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    const result = await service.handleUniverseRefresh();
    expect(result.body.data.source).toBe("remote_json");
    expect(result.body.data.symbols).toEqual(["MSFT", "BRK-B", "SPY"]);
  });

  it("falls back to a configured local universe JSON source when the remote source fails", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "market-data-universe-"));
    const universePath = path.join(tempDir, "universe.json");
    fs.writeFileSync(universePath, JSON.stringify({ data: { symbols: ["nvda", "googl"] } }, null, 2));
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_CLIENT_ID: "",
        SCHWAB_CLIENT_SECRET: "",
        SCHWAB_REFRESH_TOKEN: "",
        MARKET_DATA_UNIVERSE_SOURCE_LADDER: "remote_json,local_json",
        MARKET_DATA_UNIVERSE_REMOTE_JSON_URL: "https://example.test/universe.json",
        MARKET_DATA_UNIVERSE_LOCAL_JSON_PATH: universePath,
      },
      fetchImpl: async () => new Response("not found", { status: 404 }),
    });

    const result = await service.handleUniverseRefresh();
    expect(result.body.data.source).toBe("local_json");
    expect(result.body.data.symbols).toEqual(["NVDA", "GOOGL"]);
  });

  it("surfaces operator metrics and universe audit entries", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "market-data-ops-"));
    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        MARKET_DATA_CACHE_DIR: tempDir,
        SCHWAB_CLIENT_ID: "",
        SCHWAB_CLIENT_SECRET: "",
        SCHWAB_REFRESH_TOKEN: "",
      },
    });
    registerMarketDataRoutes(app, service);

    await service.handleUniverseRefresh();

    const opsResponse = await app.request("/market-data/ops");
    const opsBody = (await opsResponse.json()) as {
      data: {
        providerMetrics: { lastSuccessfulUniverseRefreshAt: string | null };
        providerLaneGuidance: { liveQuotes: { providerMode: string }; history: { providerMode: string } };
        universe: { latest: { source: string } | null; audit: Array<{ symbolCount: number }> };
      };
    };
    const auditResponse = await app.request("/market-data/universe/audit?limit=1");
    const auditBody = (await auditResponse.json()) as { data: { entries: Array<{ source: string; symbolCount: number }> } };

    expect(opsResponse.status).toBe(200);
    expect(opsBody.data.providerMetrics.lastSuccessfulUniverseRefreshAt).toBeTruthy();
    expect(opsBody.data.providerLaneGuidance.liveQuotes.providerMode).toBe("schwab_streamer_stale_or_unavailable");
    expect(opsBody.data.providerLaneGuidance.history.providerMode).toBe("schwab_primary");
    expect(opsBody.data.universe.latest?.source).toBe("local_json");
    expect(opsBody.data.universe.audit[0]?.symbolCount).toBeGreaterThan(500);

    expect(auditResponse.status).toBe(200);
    expect(auditBody.data.entries).toHaveLength(1);
    expect(auditBody.data.entries[0]?.source).toBe("local_json");
  });

  it("demotes the streamer leader after CLOSE_CONNECTION max-connection policy", async () => {
    FailureWebSocket.failureCode = 12;
    FailureWebSocket.failureMessage = "maximum streamer connections reached";
    const service = new MarketDataService({
      config: TEST_CONFIG,
      websocketFactory: () => new FailureWebSocket(),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/trader/v1/userPreference")) {
          return new Response(
            JSON.stringify({
              streamerInfo: {
                streamerSocketUrl: "wss://streamer.example.test/ws",
                schwabClientCustomerId: "customer-id",
                schwabClientCorrelId: "correl-id",
                schwabClientChannel: "N9",
                schwabClientFunctionId: "APIAP",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/marketdata/v1/quotes")) {
          return new Response(
            JSON.stringify({
              AAPL: {
                quote: { symbol: "AAPL", lastPrice: 199.0, tradeTimeInLong: 1_710_000_000_000 },
                reference: { currency: "USD" },
                fundamental: {},
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    await service.handleQuote(new Request("http://localhost/market-data/quote/AAPL"), "AAPL");
    const health = await service.checkHealth();
    const providers = (health.providers ?? {}) as Record<string, unknown>;

    expect(providers.schwabStreamerRole).toBe("follower");
    const streamerMeta = (providers.schwabStreamerMeta ?? {}) as Record<string, unknown>;
    expect(streamerMeta.failurePolicy).toBe("max_connections_exceeded");
    expect(streamerMeta.operatorState).toBe("max_connections_blocked");
    FailureWebSocket.failureCode = null;
  });

  it("surfaces subscription budget pressure when Schwab reports symbol limit failures", async () => {
    FailureWebSocket.failureCode = 19;
    FailureWebSocket.failureMessage = "symbol limit reached";
    const service = new MarketDataService({
      config: { ...TEST_CONFIG, SCHWAB_STREAMER_SYMBOL_SOFT_CAP: 1 },
      websocketFactory: () => new FailureWebSocket(),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/trader/v1/userPreference")) {
          return new Response(
            JSON.stringify({
              streamerInfo: {
                streamerSocketUrl: "wss://streamer.example.test/ws",
                schwabClientCustomerId: "customer-id",
                schwabClientCorrelId: "correl-id",
                schwabClientChannel: "N9",
                schwabClientFunctionId: "APIAP",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/marketdata/v1/quotes")) {
          const symbol = url.includes("symbols=MSFT") ? "MSFT" : "AAPL";
          return new Response(
            JSON.stringify({
              [symbol]: {
                quote: { symbol, lastPrice: 199.0, tradeTimeInLong: 1_710_000_000_000 },
                reference: { currency: "USD" },
                fundamental: {},
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    await service.handleQuote(new Request("http://localhost/market-data/quote/AAPL"), "AAPL");
    await service.handleQuote(new Request("http://localhost/market-data/quote/MSFT"), "MSFT");
    const health = await service.checkHealth();
    const providers = (health.providers ?? {}) as Record<string, unknown>;
    const streamerMeta = (providers.schwabStreamerMeta ?? {}) as Record<string, unknown>;
    const budget = (streamerMeta.subscriptionBudget ?? {}) as Record<string, { overSoftCap?: boolean; softCap?: number }>;

    expect(streamerMeta.failurePolicy).toBe("symbol_limit_reached");
    expect(streamerMeta.operatorState).toBe("subscription_budget_exceeded");
    expect(budget.LEVELONE_EQUITIES?.softCap).toBe(1);
    expect(budget.LEVELONE_EQUITIES?.overSoftCap).toBe(false);
    FailureWebSocket.failureCode = null;
  });

  it("prunes older requested symbols to stay within the streamer soft cap", async () => {
    FakeWebSocket.createdCount = 0;
    FakeWebSocket.sentRequests = [];
    const service = new MarketDataService({
      config: { ...TEST_CONFIG, SCHWAB_STREAMER_SYMBOL_SOFT_CAP: 2 },
      websocketFactory: () => new FakeWebSocket(),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/trader/v1/userPreference")) {
          return new Response(
            JSON.stringify({
              streamerInfo: {
                streamerSocketUrl: "wss://streamer.example.test/ws",
                schwabClientCustomerId: "customer-id",
                schwabClientCorrelId: "correl-id",
                schwabClientChannel: "N9",
                schwabClientFunctionId: "APIAP",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    await service.handleQuote(new Request("http://localhost/market-data/quote/AAPL"), "AAPL");
    await service.handleQuote(new Request("http://localhost/market-data/quote/MSFT"), "MSFT");
    await service.handleQuote(new Request("http://localhost/market-data/quote/NVDA"), "NVDA");

    const health = await service.checkHealth();
    const providers = (health.providers ?? {}) as Record<string, unknown>;
    const streamerMeta = (providers.schwabStreamerMeta ?? {}) as Record<string, unknown>;
    const budget = (streamerMeta.subscriptionBudget ?? {}) as Record<
      string,
      { requestedSymbols?: number; overSoftCap?: boolean; lastPrunedCount?: number }
    >;
    const equityCommands = FakeWebSocket.sentRequests
      .filter((request) => request.service === "LEVELONE_EQUITIES")
      .map((request) => `${request.command}:${request.keys ?? ""}`);

    expect(budget.LEVELONE_EQUITIES?.requestedSymbols).toBe(2);
    expect(budget.LEVELONE_EQUITIES?.overSoftCap).toBe(false);
    expect(budget.LEVELONE_EQUITIES?.lastPrunedCount).toBe(1);
    expect(equityCommands).toContain("UNSUBS:AAPL");
    expect(equityCommands).toContain("ADD:NVDA");
  });

  it("reads streamer-backed quote state from the shared state file in follower mode", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "market-data-streamer-state-"));
    const sharedStatePath = path.join(tempDir, "streamer-state.json");
    fs.writeFileSync(
      sharedStatePath,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          health: { connected: true },
          quotes: {
            AAPL: {
              quote: {
                symbol: "AAPL",
                price: 211.11,
                timestamp: new Date().toISOString(),
                currency: "USD",
              },
              receivedAt: new Date().toISOString(),
            },
          },
          charts: {},
        },
        null,
        2,
      ),
    );
    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_STREAMER_ROLE: "follower",
        SCHWAB_STREAMER_SHARED_STATE_PATH: sharedStatePath,
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/marketdata/v1/quotes")) {
          return new Response("not found", { status: 404 });
        }
        if (url.includes("/marketdata/v1/quotes")) {
          return new Response(
            JSON.stringify({
              AAPL: {
                quote: { symbol: "AAPL", lastPrice: 199.0, tradeTimeInLong: 1_710_000_000_000 },
                reference: { currency: "USD" },
                fundamental: {},
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/quote/AAPL");
    const body = (await response.json()) as { source: string; data: { price?: number } };

    expect(body.source).toBe("schwab_streamer_shared");
    expect(body.data.price).toBe(211.11);
  });

  it("keeps last-known Schwab quotes as degraded while the market is closed for live watchlists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T22:00:00.000Z"));
    try {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "market-data-after-hours-shared-state-"));
      const sharedStatePath = path.join(tempDir, "streamer-state.json");
      fs.writeFileSync(
        sharedStatePath,
        JSON.stringify(
          {
            updatedAt: new Date().toISOString(),
            health: { connected: true },
            quotes: {
              SPY: {
                quote: {
                  symbol: "SPY",
                  price: 211.11,
                  timestamp: new Date(Date.now() - 5 * 60_000).toISOString(),
                  currency: "USD",
                },
                receivedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
              },
            },
            charts: {},
          },
          null,
          2,
        ),
      );
      const app = new Hono();
      const service = new MarketDataService({
        config: {
          ...TEST_CONFIG,
          SCHWAB_STREAMER_ROLE: "follower",
          SCHWAB_STREAMER_SHARED_STATE_PATH: sharedStatePath,
        },
        fetchImpl: async () => new Response("not found", { status: 404 }),
      });
      registerMarketDataRoutes(app, service);

      const response = await app.request("/market-data/quote/SPY?subsystem=live_watchlists");
      const body = (await response.json()) as {
        source: string;
        status: string;
        providerMode: string;
        degradedReason: string | null;
        stalenessSeconds: number | null;
        data: { price?: number };
      };

      expect(response.status).toBe(200);
      expect(body.source).toBe("schwab_streamer_shared");
      expect(body.status).toBe("degraded");
      expect(body.providerMode).toBe("schwab_primary");
      expect(body.stalenessSeconds).toBe(300);
      expect(body.degradedReason).toContain("while the market is closed");
      expect(body.data.price).toBe(211.11);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps Friday's last Schwab quote available on Saturday morning for live watchlists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T14:57:00.000Z"));
    try {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "market-data-weekend-shared-state-"));
      const sharedStatePath = path.join(tempDir, "streamer-state.json");
      fs.writeFileSync(
        sharedStatePath,
        JSON.stringify(
          {
            updatedAt: new Date().toISOString(),
            health: { connected: true },
            quotes: {
              SPY: {
                quote: {
                  symbol: "SPY",
                  price: 211.11,
                  timestamp: "2026-04-17T19:45:00.000Z",
                  currency: "USD",
                },
                receivedAt: "2026-04-17T19:45:00.000Z",
              },
            },
            charts: {},
          },
          null,
          2,
        ),
      );
      const app = new Hono();
      const service = new MarketDataService({
        config: {
          ...TEST_CONFIG,
          SCHWAB_STREAMER_ROLE: "follower",
          SCHWAB_STREAMER_SHARED_STATE_PATH: sharedStatePath,
        },
        fetchImpl: async () => new Response("not found", { status: 404 }),
      });
      registerMarketDataRoutes(app, service);

      const response = await app.request("/market-data/quote/SPY?subsystem=live_watchlists");
      const body = (await response.json()) as {
        source: string;
        status: string;
        stalenessSeconds: number | null;
        degradedReason: string | null;
        data: { price?: number };
      };

      expect(response.status).toBe(200);
      expect(body.source).toBe("schwab_streamer_shared");
      expect(body.status).toBe("degraded");
      expect(body.stalenessSeconds).toBeGreaterThan(60_000);
      expect(body.degradedReason).toContain("while the market is closed");
      expect(body.data.price).toBe(211.11);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns unavailable for a live-watchlist single quote when streamer/shared coverage is missing", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "market-data-live-watchlist-single-"));
    const sharedStatePath = path.join(tempDir, "streamer-state.json");
    fs.writeFileSync(
      sharedStatePath,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          health: { connected: true },
          quotes: {},
          charts: {},
        },
        null,
        2,
      ),
    );

    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_STREAMER_ROLE: "follower",
        SCHWAB_STREAMER_SHARED_STATE_PATH: sharedStatePath,
      },
      fetchImpl: async () => new Response("not found", { status: 404 }),
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/quote/IWM?subsystem=live_watchlists");
    const body = (await response.json()) as {
      source: string;
      status: string;
      providerMode: string;
      fallbackEngaged: boolean;
      degradedReason: string | null;
      data: { symbol: string; price?: number };
    };

    expect(response.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.source).toBe("service");
    expect(body.providerMode).toBe("unavailable");
    expect(body.fallbackEngaged).toBe(false);
    expect(body.degradedReason).toBe("No live Schwab quote available for IWM");
    expect(body.data.symbol).toBe("IWM");
    expect(body.data.price).toBeUndefined();
  });

  it("deduplicates concurrent Schwab token refreshes", async () => {
    let refreshCalls = 0;
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_TOKEN_PATH: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "schwab-token-")), "token.json"),
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          refreshCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/marketdata/v1/quotes")) {
          return new Response(
            JSON.stringify({
              AAPL: { quote: { lastPrice: 200.5, tradeTimeInLong: 1_710_000_000_000 } },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    const [one, two] = await Promise.all([
      service.handleQuote(new Request("http://localhost/market-data/quote/AAPL"), "AAPL"),
      service.handleQuote(new Request("http://localhost/market-data/quote/AAPL"), "AAPL"),
    ]);

    expect(one.body.source).toBe("schwab");
    expect(two.body.source).toBe("schwab");
    expect(refreshCalls).toBe(1);
  });

  it("retries transient Schwab token refresh failures before serving quotes", async () => {
    let refreshCalls = 0;
    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_STREAMER_ENABLED: "0",
        SCHWAB_TOKEN_PATH: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "schwab-token-retry-")), "token.json"),
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          refreshCalls += 1;
          if (refreshCalls === 1) {
            return new Response(JSON.stringify({ error: "temporarily_unavailable" }), {
              status: 503,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/marketdata/v1/quotes")) {
          return new Response(
            JSON.stringify({
              AAPL: {
                quote: {
                  symbol: "AAPL",
                  lastPrice: 200.12,
                  tradeTimeInLong: 1_710_000_000_000,
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/quote/AAPL");
    const body = (await response.json()) as { source: string; data: { price?: number } };

    expect(response.status).toBe(200);
    expect(body.source).toBe("schwab");
    expect(body.data.price).toBe(200.12);
    expect(refreshCalls).toBe(2);

    const readyResponse = await app.request("/market-data/ready");
    const readyBody = (await readyResponse.json()) as { data: { ready: boolean; operatorState: string } };
    expect(readyResponse.status).toBe(200);
    expect(readyBody.data.ready).toBe(true);
    expect(readyBody.data.operatorState).toBe("healthy");
  });

  it.each([
    [401, { error: "invalid_grant" }],
    [400, { error: "unsupported_token_type", error_description: "refresh_token_authentication_error" }],
  ])("does not retry Schwab refresh token rejections with status %i", async (status, body) => {
    let refreshCalls = 0;
    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_STREAMER_ENABLED: "0",
        SCHWAB_TOKEN_PATH: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "schwab-token-reject-once-")), "token.json"),
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          refreshCalls += 1;
          return new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const historyResponse = await app.request("/market-data/history/AAPL?period=1mo");
    expect(historyResponse.status).toBe(503);
    expect(refreshCalls).toBe(1);

    const readyResponse = await app.request("/market-data/ready");
    const readyBody = (await readyResponse.json()) as { data: { ready: boolean; operatorState: string } };
    expect(readyResponse.status).toBe(503);
    expect(readyBody.data.ready).toBe(false);
    expect(readyBody.data.operatorState).toBe("human_action_required");
  });

  it("returns alpaca comparison metadata without changing the primary quote source", async () => {
    process.env.ALPACA_KEY = "test-key";
    process.env.ALPACA_SECRET_KEY = "test-secret";
    process.env.ALPACA_DATA_URL = "https://data.alpaca.markets";

    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_STREAMER_ENABLED: "0",
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(
            JSON.stringify({
              access_token: "access-token",
              expires_in: 1800,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/marketdata/v1/quotes")) {
          return new Response(
            JSON.stringify({
              AAPL: {
                quote: {
                  symbol: "AAPL",
                  lastPrice: 200.12,
                  tradeTimeInLong: 1_710_000_000_000,
                },
                reference: {
                  description: "Apple Inc.",
                  currency: "USD",
                },
                fundamental: {
                  marketCap: 3_000_000_000_000,
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("data.alpaca.markets") && url.includes("/trades/latest")) {
          return new Response(
            JSON.stringify({
              trade: {
                p: 199.5,
                t: "2026-03-21T14:30:00Z",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/quote/AAPL?compare_with=alpaca");
    const body = (await response.json()) as {
      source: string;
      data: { price: number };
      compare_with?: { source: string; available: boolean; mismatchSummary?: string };
    };

    expect(response.status).toBe(200);
    expect(body.source).toBe("schwab");
    expect(body.data.price).toBe(200.12);
    expect(body.compare_with?.source).toBe("alpaca");
    expect(body.compare_with?.available).toBe(true);
    expect(body.compare_with?.mismatchSummary).toContain("delta");

    delete process.env.ALPACA_KEY;
    delete process.env.ALPACA_SECRET_KEY;
    delete process.env.ALPACA_DATA_URL;
  });

  it("serves batch quotes through a single route response", async () => {
    const app = new Hono();
    const service = new MarketDataService({
      config: { ...TEST_CONFIG, SCHWAB_STREAMER_ENABLED: "0" },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/marketdata/v1/quotes")) {
          const symbol = url.includes("MSFT") ? "MSFT" : "AAPL";
          return new Response(
            JSON.stringify({
              [symbol]: {
                quote: { symbol, lastPrice: symbol === "MSFT" ? 410.5 : 201.25, tradeTimeInLong: 1_710_000_000_000 },
                reference: { currency: "USD" },
                fundamental: {},
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/quote/batch?symbols=AAPL,MSFT");
    const body = (await response.json()) as {
      providerMode: string;
      fallbackEngaged: boolean;
      data: {
        items: Array<{
          symbol: string;
          source: string;
          providerMode: string;
          fallbackEngaged: boolean;
          data: { price?: number };
        }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.providerMode).toBe("schwab_primary");
    expect(body.fallbackEngaged).toBe(false);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items.map((item) => item.symbol)).toEqual(["AAPL", "MSFT"]);
    expect(body.data.items.every((item) => item.source === "schwab")).toBe(true);
    expect(body.data.items.every((item) => item.providerMode === "schwab_primary")).toBe(true);
  });

  it("marks quote batches as multi_mode when successful and unavailable item modes coexist", async () => {
    const app = new Hono();
    const service = new MarketDataService({
      config: { ...TEST_CONFIG, SCHWAB_STREAMER_ENABLED: "0" },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/marketdata/v1/quotes")) {
          if (url.includes("AAPL")) {
            return new Response(JSON.stringify({ error: "symbol unavailable" }), {
              status: 503,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response(
            JSON.stringify({
              MSFT: {
                quote: { symbol: "MSFT", lastPrice: 410.5, tradeTimeInLong: 1_710_000_000_000 },
                reference: { currency: "USD" },
                fundamental: {},
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/quote/batch?symbols=AAPL,MSFT");
    const body = (await response.json()) as {
      status: string;
      providerMode: string;
      providerModeReason: string;
      data: {
        items: Array<{
          symbol: string;
          providerMode: string;
          source: string;
        }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.providerMode).toBe("multi_mode");
    expect(body.providerModeReason).toContain("more than one provider mode");
    expect(body.data.items).toEqual([
      expect.objectContaining({ symbol: "AAPL", providerMode: "unavailable", source: "service" }),
      expect.objectContaining({ symbol: "MSFT", providerMode: "schwab_primary", source: "schwab" }),
    ]);
  });

  it("uses Alpaca fallback for approved quote-batch subsystems when Schwab REST cooldown is open", async () => {
    process.env.ALPACA_KEY = "test-key";
    process.env.ALPACA_SECRET_KEY = "test-secret";
    process.env.ALPACA_DATA_URL = "https://data.alpaca.markets";

    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_STREAMER_ENABLED: "0",
        MARKET_DATA_SCHWAB_FAILURE_THRESHOLD: 1,
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/marketdata/v1/quotes")) {
          return new Response(JSON.stringify({ error: "schwab unavailable" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("data.alpaca.markets") && url.includes("/trades/latest")) {
          const symbol = url.includes("/MSFT/") ? "MSFT" : "AAPL";
          return new Response(
            JSON.stringify({
              trade: {
                t: "2026-04-10T17:30:00Z",
                p: symbol === "MSFT" ? 410.25 : 201.5,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    await app.request("/market-data/quote/AAPL");

    const response = await app.request("/market-data/quote/batch?symbols=AAPL,MSFT&subsystem=intraday_breadth");
    const body = (await response.json()) as {
      providerMode: string;
      fallbackEngaged: boolean;
      data: {
        items: Array<{
          symbol: string;
          source: string;
          providerMode: string;
          fallbackEngaged: boolean;
          data: { price?: number };
        }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.providerMode).toBe("alpaca_fallback");
    expect(body.fallbackEngaged).toBe(true);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items.every((item) => item.source === "alpaca")).toBe(true);
    expect(body.data.items.every((item) => item.providerMode === "alpaca_fallback")).toBe(true);

    delete process.env.ALPACA_KEY;
    delete process.env.ALPACA_SECRET_KEY;
    delete process.env.ALPACA_DATA_URL;
  });

  it("keeps the live-watchlist batch streamer-only when some symbols are missing streamer/shared coverage", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "market-data-live-watchlist-lane-"));
    const sharedStatePath = path.join(tempDir, "streamer-state.json");
    fs.writeFileSync(
      sharedStatePath,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          health: { connected: true },
          quotes: {
            SPY: {
              quote: {
                symbol: "SPY",
                price: 510.12,
                changePercent: 1.25,
                timestamp: new Date().toISOString(),
                currency: "USD",
              },
              receivedAt: new Date().toISOString(),
            },
            QQQ: {
              quote: {
                symbol: "QQQ",
                price: 441.18,
                changePercent: 2.1,
                timestamp: new Date().toISOString(),
                currency: "USD",
              },
              receivedAt: new Date().toISOString(),
            },
          },
          charts: {},
        },
        null,
        2,
      ),
    );

    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_STREAMER_ROLE: "follower",
        SCHWAB_STREAMER_SHARED_STATE_PATH: sharedStatePath,
      },
      fetchImpl: async () => new Response("not found", { status: 404 }),
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/quote/batch?symbols=SPY,QQQ,IWM,DIA&subsystem=live_watchlists");
    const body = (await response.json()) as {
      status: string;
      providerMode: string;
      fallbackEngaged: boolean;
      degradedReason: string | null;
      data: {
        items: Array<{
          symbol: string;
          source: string;
          status: string;
          providerMode: string;
          degradedReason: string | null;
          data: { price?: number };
        }>;
      };
    };
    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.providerMode).toBe("multi_mode");
    expect(body.fallbackEngaged).toBe(false);
    expect(body.degradedReason).toBe("2 batch item(s) failed");
    expect(body.data.items).toEqual([
      expect.objectContaining({
        symbol: "SPY",
        source: "schwab_streamer_shared",
        status: "ok",
        providerMode: "schwab_primary",
        data: expect.objectContaining({ price: 510.12 }),
      }),
      expect.objectContaining({
        symbol: "QQQ",
        source: "schwab_streamer_shared",
        status: "ok",
        providerMode: "schwab_primary",
        data: expect.objectContaining({ price: 441.18 }),
      }),
      expect.objectContaining({
        symbol: "IWM",
        source: "service",
        status: "error",
        providerMode: "unavailable",
        degradedReason: "No live Schwab quote available for IWM",
      }),
      expect.objectContaining({
        symbol: "DIA",
        source: "service",
        status: "error",
        providerMode: "unavailable",
        degradedReason: "No live Schwab quote available for DIA",
      }),
    ]);
  });

  it("preserves streamer-backed batch rows when other live-watchlist symbols have no usable Schwab quote", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "market-data-live-watchlist-batch-"));
    const sharedStatePath = path.join(tempDir, "streamer-state.json");
    fs.writeFileSync(
      sharedStatePath,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          health: { connected: true },
          quotes: {
            SPY: {
              quote: {
                symbol: "SPY",
                price: 510.12,
                changePercent: 1.25,
                timestamp: new Date().toISOString(),
                currency: "USD",
              },
              receivedAt: new Date().toISOString(),
            },
            QQQ: {
              quote: {
                symbol: "QQQ",
                price: 441.18,
                changePercent: 2.1,
                timestamp: new Date().toISOString(),
                currency: "USD",
              },
              receivedAt: new Date().toISOString(),
            },
          },
          charts: {},
        },
        null,
        2,
      ),
    );

    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_STREAMER_ROLE: "follower",
        SCHWAB_STREAMER_SHARED_STATE_PATH: sharedStatePath,
        MARKET_DATA_SCHWAB_FAILURE_THRESHOLD: 1,
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/marketdata/v1/quotes")) {
          return new Response(JSON.stringify({ error: "schwab unavailable" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    await app.request("/market-data/quote/AAPL");

    const response = await app.request("/market-data/quote/batch?symbols=SPY,QQQ,IWM,DIA&subsystem=live_watchlists");
    const body = (await response.json()) as {
      status: string;
      providerMode: string;
      degradedReason: string;
      data: {
        items: Array<{
          symbol: string;
          source: string;
          status: string;
          providerMode: string;
          degradedReason: string | null;
          data: { price?: number };
        }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.providerMode).toBe("multi_mode");
    expect(body.degradedReason).toBe("2 batch item(s) failed");
    expect(body.data.items).toEqual([
      expect.objectContaining({
        symbol: "SPY",
        source: "schwab_streamer_shared",
        status: "ok",
        providerMode: "schwab_primary",
        data: expect.objectContaining({ price: 510.12 }),
      }),
      expect.objectContaining({
        symbol: "QQQ",
        source: "schwab_streamer_shared",
        status: "ok",
        providerMode: "schwab_primary",
        data: expect.objectContaining({ price: 441.18 }),
      }),
      expect.objectContaining({
        symbol: "IWM",
        source: "service",
        status: "error",
        providerMode: "unavailable",
        degradedReason: "No live Schwab quote available for IWM",
      }),
      expect.objectContaining({
        symbol: "DIA",
        source: "service",
        status: "error",
        providerMode: "unavailable",
        degradedReason: "No live Schwab quote available for DIA",
      }),
    ]);
  });

  it("serves batch history with shared interval/provider inputs", async () => {
    process.env.ALPACA_KEY = "test-key";
    process.env.ALPACA_SECRET_KEY = "test-secret";
    process.env.ALPACA_DATA_URL = "https://data.alpaca.markets";

    const app = new Hono();
    const service = new MarketDataService({
      config: { ...TEST_CONFIG, SCHWAB_CLIENT_ID: "", SCHWAB_CLIENT_SECRET: "", SCHWAB_REFRESH_TOKEN: "" },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("data.alpaca.markets") && url.includes("/bars")) {
          const symbol = url.includes("/MSFT/") ? "MSFT" : "AAPL";
          return new Response(
            JSON.stringify({
              bars: [{ t: "2026-03-20T00:00:00Z", o: 10, h: 12, l: 9, c: symbol === "MSFT" ? 11.5 : 10.5, v: 1000 }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/history/batch?symbols=AAPL,MSFT&period=1mo&interval=1wk&provider=alpaca");
    const body = (await response.json()) as {
      providerMode: string;
      fallbackEngaged: boolean;
      data: {
        items: Array<{
          symbol: string;
          source: string;
          providerMode: string;
          fallbackEngaged: boolean;
          data: { interval: string; rows: Array<unknown> };
        }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.providerMode).toBe("alpaca_fallback");
    expect(body.fallbackEngaged).toBe(true);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items.every((item) => item.source === "alpaca")).toBe(true);
    expect(body.data.items.every((item) => item.providerMode === "alpaca_fallback")).toBe(true);
    expect(body.data.items.every((item) => item.data.interval === "1wk")).toBe(true);

    delete process.env.ALPACA_KEY;
    delete process.env.ALPACA_SECRET_KEY;
    delete process.env.ALPACA_DATA_URL;
  });

  it("uses Alpaca fallback for approved history subsystems when Schwab REST cooldown is open", async () => {
    process.env.ALPACA_KEY = "test-key";
    process.env.ALPACA_SECRET_KEY = "test-secret";
    process.env.ALPACA_DATA_URL = "https://data.alpaca.markets";

    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_STREAMER_ENABLED: "0",
        MARKET_DATA_SCHWAB_FAILURE_THRESHOLD: 1,
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/marketdata/v1/pricehistory")) {
          return new Response(JSON.stringify({ error: "schwab unavailable" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("data.alpaca.markets") && url.includes("/bars")) {
          const symbol = url.includes("/MSFT/") ? "MSFT" : "AAPL";
          return new Response(
            JSON.stringify({
              bars: [{ t: "2026-03-20T00:00:00Z", o: 10, h: 12, l: 9, c: symbol === "MSFT" ? 11.5 : 10.5, v: 1000 }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    await app.request("/market-data/history/AAPL?period=1mo&interval=1wk");

    const response = await app.request(
      "/market-data/history/batch?symbols=AAPL,MSFT&period=1mo&interval=1wk&subsystem=market_regime",
    );
    const body = (await response.json()) as {
      providerMode: string;
      fallbackEngaged: boolean;
      data: {
        items: Array<{
          symbol: string;
          source: string;
          providerMode: string;
          fallbackEngaged: boolean;
          data: { interval: string; rows: Array<unknown> };
        }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.providerMode).toBe("alpaca_fallback");
    expect(body.fallbackEngaged).toBe(true);
    expect(body.data.items.every((item) => item.source === "alpaca")).toBe(true);
    expect(body.data.items.every((item) => item.providerMode === "alpaca_fallback")).toBe(true);
    expect(body.data.items.every((item) => item.data.interval === "1wk")).toBe(true);

    delete process.env.ALPACA_KEY;
    delete process.env.ALPACA_SECRET_KEY;
    delete process.env.ALPACA_DATA_URL;
  });

  it("keeps fundamentals on the Schwab-only lane even for fallback-approved subsystems", async () => {
    process.env.ALPACA_KEY = "test-key";
    process.env.ALPACA_SECRET_KEY = "test-secret";
    process.env.ALPACA_DATA_URL = "https://data.alpaca.markets";

    const app = new Hono();
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_STREAMER_ENABLED: "0",
        MARKET_DATA_SCHWAB_FAILURE_THRESHOLD: 1,
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/marketdata/v1/quotes")) {
          return new Response(JSON.stringify({ error: "schwab unavailable" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("data.alpaca.markets")) {
          return new Response(JSON.stringify({ trade: { t: "2026-04-10T17:30:00Z", p: 201.5 } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    await app.request("/market-data/quote/AAPL");

    const response = await app.request("/market-data/fundamentals/AAPL?subsystem=intraday_breadth");
    const body = (await response.json()) as {
      providerMode: string;
      source: string;
      status: string;
      fallbackEngaged: boolean;
    };

    expect(response.status).toBe(503);
    expect(body.source).toBe("service");
    expect(body.status).toBe("error");
    expect(body.providerMode).toBe("unavailable");
    expect(body.fallbackEngaged).toBe(false);

    delete process.env.ALPACA_KEY;
    delete process.env.ALPACA_SECRET_KEY;
    delete process.env.ALPACA_DATA_URL;
  });

  it("exposes a readiness route with operator state", async () => {
    const app = new Hono();
    const service = new MarketDataService({
      config: { ...TEST_CONFIG, SCHWAB_CLIENT_ID: "", SCHWAB_CLIENT_SECRET: "", SCHWAB_REFRESH_TOKEN: "" },
      fetchImpl: async () => new Response("not found", { status: 404 }),
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/ready");
    const body = (await response.json()) as { data: { ready: boolean; operatorState: string } };

    expect(response.status).toBe(200);
    expect(body.data.ready).toBe(true);
    expect(body.data.operatorState).toBe("healthy");
  });

  it("rejects yahoo as an unsupported history provider", async () => {
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_STREAMER_ENABLED: "0",
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/marketdata/v1/pricehistory")) {
          return new Response(
            JSON.stringify({
              candles: [{ datetime: "2026-03-01T00:00:00Z", open: 100, high: 101, low: 99, close: 100.5, volume: 1000 }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });

    await expect(service.handleHistory(new Request("http://localhost/market-data/history/AAPL?provider=yahoo"), "AAPL")).resolves.toMatchObject({
      status: 400,
    });
  });

  it("honors weekly history intervals for Schwab history", async () => {
    const requestedUrls: string[] = [];
    const app = new Hono();
    const service = new MarketDataService({
      config: TEST_CONFIG,
      fetchImpl: async (input) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.includes("/oauth/token")) {
          return new Response(JSON.stringify({ access_token: "access-token", expires_in: 1800 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/marketdata/v1/pricehistory")) {
          return new Response(
            JSON.stringify({
              candles: [
                { datetime: 1_741_027_200_000, open: 100, high: 105, low: 99, close: 104, volume: 1000000 },
                { datetime: 1_741_632_000_000, open: 104, high: 108, low: 103, close: 107, volume: 900000 },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/marketdata/v1/quotes")) {
          return new Response(
            JSON.stringify({
              AAPL: {
                quote: { symbol: "AAPL", lastPrice: 105, tradeTimeInLong: 1_710_000_000_000 },
                reference: { currency: "USD" },
                fundamental: {},
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/history/AAPL?period=3mo&interval=1wk");
    const body = (await response.json()) as { source: string; data: { interval: string; rows: Array<unknown> } };

    expect(response.status).toBe(200);
    expect(body.source).toBe("schwab");
    expect(body.data.interval).toBe("1wk");
    expect(body.data.rows).toHaveLength(2);
    expect(requestedUrls.some((url) => url.includes("frequencyType=weekly"))).toBe(true);
  });

  it("honors explicit history provider overrides", async () => {
    process.env.ALPACA_KEY = "test-key";
    process.env.ALPACA_SECRET_KEY = "test-secret";
    process.env.ALPACA_DATA_URL = "https://data.alpaca.markets";

    const app = new Hono();
    const service = new MarketDataService({
      config: TEST_CONFIG,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("data.alpaca.markets") && url.includes("/bars")) {
          return new Response(
            JSON.stringify({
              bars: [
                { t: "2026-03-20T00:00:00Z", o: 10, h: 11, l: 9, c: 10.5, v: 1000 },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/history/AAPL?provider=alpaca");
    const body = (await response.json()) as { source: string; data: { rows: Array<unknown> } };

    expect(response.status).toBe(200);
    expect(body.source).toBe("alpaca");
    expect(body.data.rows).toHaveLength(1);

    delete process.env.ALPACA_KEY;
    delete process.env.ALPACA_SECRET_KEY;
    delete process.env.ALPACA_DATA_URL;
  });

  it("normalizes market symbols", () => {
    expect(normalizeMarketSymbol(" aapl ")).toBe("AAPL");
    expect(normalizeMarketSymbol("msft")).toBe("MSFT");
    expect(normalizeMarketSymbol("")).toBe("");
  });
});
