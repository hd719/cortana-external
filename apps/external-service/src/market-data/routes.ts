import type { Hono } from "hono";

import type { MarketDataService } from "./service.js";

export function registerMarketDataRoutes(app: Hono, service: MarketDataService): void {
  app.get("/market-data/history/:symbol", async (c) => {
    const compareWith = c.req.query("compare_with");
    const result = await service.handleHistory(c.req.raw, c.req.param("symbol"), compareWith);
    return c.json(result.body, result.status as never);
  });

  app.get("/market-data/quote/:symbol", async (c) => {
    const compareWith = c.req.query("compare_with");
    const result = await service.handleQuote(c.req.raw, c.req.param("symbol"), compareWith);
    return c.json(result.body, result.status as never);
  });

  app.get("/market-data/snapshot/:symbol", async (c) => {
    const compareWith = c.req.query("compare_with");
    const result = await service.handleSnapshot(c.req.raw, c.req.param("symbol"), compareWith);
    return c.json(result.body, result.status as never);
  });

  app.get("/market-data/fundamentals/:symbol", async (c) => {
    const compareWith = c.req.query("compare_with");
    const result = await service.handleFundamentals(c.req.raw, c.req.param("symbol"), compareWith);
    return c.json(result.body, result.status as never);
  });

  app.get("/market-data/metadata/:symbol", async (c) => {
    const compareWith = c.req.query("compare_with");
    const result = await service.handleMetadata(c.req.raw, c.req.param("symbol"), compareWith);
    return c.json(result.body, result.status as never);
  });

  app.get("/market-data/news/:symbol", async (c) => {
    const compareWith = c.req.query("compare_with");
    const result = await service.handleNews(c.req.raw, c.req.param("symbol"), compareWith);
    return c.json(result.body, result.status as never);
  });

  app.get("/market-data/universe/base", async (c) => {
    const result = await service.handleUniverseBase();
    return c.json(result.body, result.status as never);
  });

  app.post("/market-data/universe/refresh", async (c) => {
    const result = await service.handleUniverseRefresh();
    return c.json(result.body, result.status as never);
  });

  app.get("/market-data/risk/history", async (c) => {
    const result = await service.handleRiskHistory(c.req.raw);
    return c.json(result.body, result.status as never);
  });

  app.get("/market-data/risk/snapshot", async (c) => {
    void c;
    const result = await service.handleRiskSnapshot();
    return c.json(result.body, result.status as never);
  });
}
