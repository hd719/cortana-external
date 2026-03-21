import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { registerMarketDataRoutes } from "../market-data/index.js";
import { MarketDataService, normalizeMarketSymbol } from "../market-data/service.js";

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
