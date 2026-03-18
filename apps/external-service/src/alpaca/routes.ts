import type { Hono } from "hono";

import { AlpacaService } from "./service.js";

export function registerAlpacaRoutes(app: Hono, service: AlpacaService): void {
  app.get("/alpaca/health", (c) => service.healthHandler(c));
  app.get("/alpaca/account", (c) => service.accountHandler(c));
  app.get("/alpaca/positions", (c) => service.positionsHandler(c));
  app.get("/alpaca/portfolio", (c) => service.portfolioHandler(c));
  app.get("/alpaca/earnings", (c) => service.earningsHandler(c));
  app.get("/alpaca/quote/:symbol", (c) => service.quoteHandler(c));
  app.get("/alpaca/snapshot/:symbol", (c) => service.snapshotHandler(c));
  app.get("/alpaca/bars/:symbol", (c) => service.barsHandler(c));
  app.get("/alpaca/trades", (c) => service.tradesHandler(c));
  app.post("/alpaca/trades", (c) => service.recordTradeHandler(c));
  app.put("/alpaca/trades/:id", (c) => service.updateTradeHandler(c));
  app.get("/alpaca/stats", (c) => service.statsHandler(c));
  app.get("/alpaca/performance", (c) => service.performanceHandler(c));
}
