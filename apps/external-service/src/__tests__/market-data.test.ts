import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { AppConfig } from "../config.js";
import { registerMarketDataRoutes } from "../market-data/index.js";
import { MarketDataService, normalizeMarketSymbol } from "../market-data/service.js";
import type { WebSocketLike } from "../market-data/streamer.js";

const TEST_CONFIG: AppConfig = {
  PORT: 3033,
  MARKET_DATA_CACHE_DIR: ".cache/market_data",
  MARKET_DATA_REQUEST_TIMEOUT_MS: 30_000,
  MARKET_DATA_UNIVERSE_SEED_PATH: "backtester/data/universe.py",
  SCHWAB_CLIENT_ID: "client",
  SCHWAB_CLIENT_SECRET: "secret",
  SCHWAB_REFRESH_TOKEN: "refresh",
  SCHWAB_TOKEN_PATH: ".cache/market_data/schwab-token.json",
  SCHWAB_API_BASE_URL: "https://api.schwabapi.com",
  SCHWAB_TOKEN_URL: "https://api.schwabapi.com/v1/oauth/token",
  SCHWAB_USER_PREFERENCES_URL: "https://api.schwabapi.com/trader/v1/userPreference",
  SCHWAB_STREAMER_ENABLED: "1",
  SCHWAB_STREAMER_CONNECT_TIMEOUT_MS: 1_000,
  SCHWAB_STREAMER_QUOTE_TTL_MS: 15_000,
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
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;

  constructor() {
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.({});
    });
  }

  send(data: string): void {
    const payload = JSON.parse(data) as { requests?: Array<{ service: string; command: string }> };
    const request = payload.requests?.[0];
    if (!request) {
      return;
    }
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
    if (request.service === "LEVELONE_EQUITIES" && request.command === "SUBS") {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            data: [
              {
                service: "LEVELONE_EQUITIES",
                timestamp: 1_710_000_100_000,
                command: "SUBS",
                content: [
                  {
                    key: "AAPL",
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
    if (request.service === "CHART_EQUITY" && request.command === "SUBS") {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            data: [
              {
                service: "CHART_EQUITY",
                timestamp: 1_710_000_120_000,
                command: "SUBS",
                content: [
                  {
                    "0": "AAPL",
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
    }
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

describe("market-data routes", () => {
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

  it("refreshes universe artifact from python static seed", async () => {
    const service = new MarketDataService();
    const result = await service.handleUniverseRefresh();

    expect(result.status).toBe(200);
    expect(result.body.data.source).toBe("static_python_seed");
    expect(result.body.data.symbols.length).toBeGreaterThan(300);
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

  it("normalizes market symbols", () => {
    expect(normalizeMarketSymbol(" aapl ")).toBe("AAPL");
    expect(normalizeMarketSymbol("msft")).toBe("MSFT");
    expect(normalizeMarketSymbol("")).toBe("");
  });
});
