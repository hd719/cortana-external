import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { AppConfig } from "../config.js";
import { registerMarketDataRoutes } from "../market-data/index.js";
import { MarketDataService } from "../market-data/service.js";
import { normalizeMarketSymbol } from "../market-data/route-utils.js";
import { SchwabStreamerSession, type WebSocketLike } from "../market-data/streamer.js";

const TEST_CONFIG: AppConfig = {
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
  SCHWAB_CLIENT_ID: "client",
  SCHWAB_CLIENT_SECRET: "secret",
  SCHWAB_REFRESH_TOKEN: "refresh",
  SCHWAB_TOKEN_PATH: ".cache/market_data/schwab-token.json",
  SCHWAB_API_BASE_URL: "https://api.schwabapi.com",
  SCHWAB_TOKEN_URL: "https://api.schwabapi.com/v1/oauth/token",
  SCHWAB_USER_PREFERENCES_URL: "https://api.schwabapi.com/trader/v1/userPreference",
  SCHWAB_STREAMER_ENABLED: "1",
  SCHWAB_STREAMER_ROLE: "leader",
  SCHWAB_STREAMER_PG_LOCK_KEY: 814021,
  SCHWAB_STREAMER_SHARED_STATE_BACKEND: "file",
  SCHWAB_STREAMER_SHARED_STATE_PATH: ".cache/market_data/test-schwab-streamer-state.json",
  SCHWAB_STREAMER_CONNECT_TIMEOUT_MS: 1_000,
  SCHWAB_STREAMER_QUOTE_TTL_MS: 15_000,
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
  TONAL_EMAIL: "",
  TONAL_PASSWORD: "",
  TONAL_TOKEN_PATH: "tonal_tokens.json",
  TONAL_DATA_PATH: "tonal_data.json",
  ALPACA_KEYS_PATH: "",
  ALPACA_TARGET_ENVIRONMENT: "live",
  CORTANA_DATABASE_URL: "postgres://localhost:5432/cortana?sslmode=disable",
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

  it("returns yahoo-backed quote payload for quote endpoint", async () => {
    const app = new Hono();
    const service = new MarketDataService({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            quoteResponse: {
              result: [
                {
                  symbol: "AAPL",
                  regularMarketPrice: 200.12,
                  regularMarketChange: 1.23,
                  regularMarketChangePercent: 0.62,
                  regularMarketTime: 1_710_000_000,
                  currency: "USD",
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    registerMarketDataRoutes(app, service);

    const response = await app.request("/market-data/quote/AAPL");
    const body = (await response.json()) as { source: string; status: string; data: { symbol: string; price: number } };

    expect(response.status).toBe(200);
    expect(body.source).toBe("yahoo");
    expect(body.status).toBe("ok");
    expect(body.data.symbol).toBe("AAPL");
    expect(body.data.price).toBe(200.12);
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
        if (url.includes("query1.finance.yahoo.com/v8/finance/chart")) {
          return new Response(
            JSON.stringify({
              chart: {
                result: [
                  {
                    timestamp: [1_710_000_000, 1_710_086_400],
                    indicators: {
                      quote: [
                        {
                          open: [200, 201],
                          high: [202, 203],
                          low: [199, 200],
                          close: [201, 202],
                          volume: [1000, 1100],
                        },
                      ],
                    },
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

    const historyResponse = await app.request("/market-data/history/AAPL?period=1mo");
    const historyBody = (await historyResponse.json()) as { source: string; status: string };
    expect(historyResponse.status).toBe(200);
    expect(historyBody.source).toBe("yahoo");
    expect(historyBody.status).toBe("degraded");

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
        if (url.includes("query1.finance.yahoo.com/v10/finance/quoteSummary")) {
          return new Response(
            JSON.stringify({
              quoteSummary: {
                result: [
                  {
                    summaryProfile: { sector: "Technology", industry: "Consumer Electronics" },
                    defaultKeyStatistics: {},
                    financialData: {},
                    price: { shortName: "Apple Inc." },
                    calendarEvents: { earnings: { earningsDate: [] } },
                    earningsTrend: { trend: [] },
                  },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("query1.finance.yahoo.com/v7/finance/quote")) {
          return new Response(
            JSON.stringify({
              quoteResponse: { result: [{ symbol: "AAPL", regularMarketPrice: 200.12, currency: "USD" }] },
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

  it("uses Schwab fundamentals as primary and Yahoo only for missing fields", async () => {
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
        if (url.includes("quoteSummary/AAPL")) {
          return new Response(
            JSON.stringify({
              quoteSummary: {
                result: [
                  {
                    summaryProfile: { sector: "Technology", industry: "Consumer Electronics" },
                    defaultKeyStatistics: { heldPercentInstitutions: { raw: 0.61 } },
                    financialData: { earningsGrowth: { raw: 0.18 }, revenueGrowth: { raw: 0.12 } },
                    calendarEvents: { earnings: { earningsDate: [{ fmt: "2026-05-01" }] } },
                    earningsTrend: { trend: [{ growth: { raw: 0.22 } }] },
                  },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/v7/finance/quote")) {
          return new Response(
            JSON.stringify({
              quoteResponse: {
                result: [
                  {
                    symbol: "AAPL",
                    regularMarketPrice: 201.5,
                    regularMarketChange: 1.2,
                    regularMarketChangePercent: 0.6,
                    regularMarketTime: 1_710_000_000,
                    currency: "USD",
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

    const response = await app.request("/market-data/fundamentals/AAPL");
    const body = (await response.json()) as { source: string; data: { payload: Record<string, unknown> } };

    expect(response.status).toBe(200);
    expect(body.source).toBe("schwab");
    expect(body.data.payload.float_shares).toBe(15_500_000_000);
    expect(body.data.payload.sector).toBe("Technology");
    expect(body.data.payload.institutional_pct).toBeCloseTo(0.61);
  });

  it("refreshes universe artifact from python static seed", async () => {
    const service = new MarketDataService();
    const result = await service.handleUniverseRefresh();

    expect(result.status).toBe(200);
    expect(result.body.data.source).toBe("static_python_seed");
    expect(result.body.data.symbols.length).toBeGreaterThan(300);
  });

  it("prefers a configured remote universe JSON source", async () => {
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_CLIENT_ID: "",
        SCHWAB_CLIENT_SECRET: "",
        SCHWAB_REFRESH_TOKEN: "",
        MARKET_DATA_UNIVERSE_SOURCE_LADDER: "remote_json,python_seed",
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
        MARKET_DATA_UNIVERSE_SOURCE_LADDER: "remote_json,local_json,python_seed",
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
        universe: { latest: { source: string } | null; audit: Array<{ symbolCount: number }> };
      };
    };
    const auditResponse = await app.request("/market-data/universe/audit?limit=1");
    const auditBody = (await auditResponse.json()) as { data: { entries: Array<{ source: string; symbolCount: number }> } };

    expect(opsResponse.status).toBe(200);
    expect(opsBody.data.providerMetrics.lastSuccessfulUniverseRefreshAt).toBeTruthy();
    expect(opsBody.data.universe.latest?.source).toBe("static_python_seed");
    expect(opsBody.data.universe.audit[0]?.symbolCount).toBeGreaterThan(300);

    expect(auditResponse.status).toBe(200);
    expect(auditBody.data.entries).toHaveLength(1);
    expect(auditBody.data.entries[0]?.source).toBe("static_python_seed");
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
        if (url.includes("query1.finance.yahoo.com/v7/finance/quote")) {
          return new Response(
            JSON.stringify({
              quoteResponse: { result: [{ symbol: "AAPL", regularMarketPrice: 199.0, currency: "USD" }] },
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
        if (url.includes("query1.finance.yahoo.com/v7/finance/quote")) {
          const symbol = url.includes("symbols=MSFT") ? "MSFT" : "AAPL";
          return new Response(
            JSON.stringify({
              quoteResponse: { result: [{ symbol, regularMarketPrice: 199.0, currency: "USD" }] },
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
        if (url.includes("query1.finance.yahoo.com/v7/finance/quote")) {
          return new Response(
            JSON.stringify({
              quoteResponse: { result: [{ symbol: "AAPL", regularMarketPrice: 199.0, currency: "USD" }] },
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

  it("returns alpaca comparison metadata without changing the primary quote source", async () => {
    process.env.ALPACA_KEY = "test-key";
    process.env.ALPACA_SECRET_KEY = "test-secret";
    process.env.ALPACA_DATA_URL = "https://data.alpaca.markets";

    const app = new Hono();
    const service = new MarketDataService({
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("query1.finance.yahoo.com/v7/finance/quote")) {
          return new Response(
            JSON.stringify({
              quoteResponse: {
                result: [
                  {
                    symbol: "AAPL",
                    regularMarketPrice: 200.12,
                    regularMarketChange: 1.23,
                    regularMarketChangePercent: 0.62,
                    regularMarketTime: 1_710_000_000,
                    currency: "USD",
                  },
                ],
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
    expect(body.source).toBe("yahoo");
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
      config: { ...TEST_CONFIG, SCHWAB_CLIENT_ID: "", SCHWAB_CLIENT_SECRET: "", SCHWAB_REFRESH_TOKEN: "" },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("query1.finance.yahoo.com/v7/finance/quote")) {
          const symbol = url.includes("MSFT") ? "MSFT" : "AAPL";
          return new Response(
            JSON.stringify({
              quoteResponse: {
                result: [
                  {
                    symbol,
                    regularMarketPrice: symbol === "MSFT" ? 410.5 : 201.25,
                    regularMarketChangePercent: 1.5,
                    regularMarketTime: 1_710_000_000,
                    currency: "USD",
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

    const response = await app.request("/market-data/quote/batch?symbols=AAPL,MSFT");
    const body = (await response.json()) as { data: { items: Array<{ symbol: string; source: string; data: { price?: number } }> } };

    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items.map((item) => item.symbol)).toEqual(["AAPL", "MSFT"]);
    expect(body.data.items.every((item) => item.source === "yahoo")).toBe(true);
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
    const body = (await response.json()) as { data: { items: Array<{ symbol: string; source: string; data: { interval: string; rows: Array<unknown> } }> } };

    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items.every((item) => item.source === "alpaca")).toBe(true);
    expect(body.data.items.every((item) => item.data.interval === "1wk")).toBe(true);

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

  it("opens the Yahoo circuit after repeated failures", async () => {
    const service = new MarketDataService({
      config: {
        ...TEST_CONFIG,
        SCHWAB_CLIENT_ID: "",
        SCHWAB_CLIENT_SECRET: "",
        SCHWAB_REFRESH_TOKEN: "",
        MARKET_DATA_YAHOO_CIRCUIT_FAILURE_THRESHOLD: 2,
        MARKET_DATA_YAHOO_CIRCUIT_COOLDOWN_MS: 60_000,
      },
      fetchImpl: async () => new Response("bad gateway", { status: 502 }),
    });

    await expect(service.handleQuote(new Request("http://localhost/market-data/quote/AAPL"), "AAPL")).resolves.toMatchObject({
      status: 503,
    });
    await expect(service.handleQuote(new Request("http://localhost/market-data/quote/MSFT"), "MSFT")).resolves.toMatchObject({
      status: 503,
    });

    const health = await service.checkHealth();
    const providers = (health.providers ?? {}) as Record<string, unknown>;
    const metrics = (providers.providerMetrics ?? {}) as Record<string, unknown>;

    expect(metrics.yahooConsecutiveFailures).toBe(2);
    expect(metrics.yahooCircuitOpenUntil).toBeTruthy();
  });

  it("honors weekly history intervals when falling back to Yahoo", async () => {
    const requestedUrls: string[] = [];
    const app = new Hono();
    const service = new MarketDataService({
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
          return new Response("schwab unavailable", { status: 503 });
        }
        if (url.includes("query1.finance.yahoo.com/v8/finance/chart/AAPL")) {
          return new Response(
            JSON.stringify({
              chart: {
                result: [
                  {
                    timestamp: [1_710_000_000, 1_710_604_800],
                    indicators: {
                      quote: [
                        {
                          open: [100, 102],
                          high: [105, 106],
                          low: [99, 101],
                          close: [104, 105],
                          volume: [1_000_000, 900_000],
                        },
                      ],
                    },
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

    const response = await app.request("/market-data/history/AAPL?period=3mo&interval=1wk");
    const body = (await response.json()) as { source: string; data: { interval: string; rows: Array<unknown> } };

    expect(response.status).toBe(200);
    expect(body.source).toBe("yahoo");
    expect(body.data.interval).toBe("1wk");
    expect(body.data.rows).toHaveLength(2);
    expect(requestedUrls.some((url) => url.includes("interval=1wk"))).toBe(true);
  });

  it("honors explicit history provider overrides", async () => {
    process.env.ALPACA_KEY = "test-key";
    process.env.ALPACA_SECRET_KEY = "test-secret";
    process.env.ALPACA_DATA_URL = "https://data.alpaca.markets";

    const app = new Hono();
    const service = new MarketDataService({
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
        if (url.includes("query1.finance.yahoo.com/v8/finance/chart/AAPL")) {
          return new Response(
            JSON.stringify({
              chart: {
                result: [
                  {
                    timestamp: [1_710_000_000],
                    indicators: { quote: [{ open: [20], high: [21], low: [19], close: [20.5], volume: [2000] }] },
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
