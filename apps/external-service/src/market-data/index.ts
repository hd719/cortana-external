import type { Hono } from "hono";

import type { AppConfig } from "../config.js";
import { createLogger } from "../lib/logger.js";
import { registerMarketDataRoutes as registerRoutes } from "./routes.js";
import { MarketDataService } from "./service.js";

export function createMarketDataService(config: AppConfig): MarketDataService {
  return new MarketDataService({
    config,
    logger: createLogger("market-data"),
  });
}

export function registerMarketDataRoutes(app: Hono, service: MarketDataService): void {
  registerRoutes(app, service);
}

export { MarketDataService, normalizeMarketSymbol } from "./service.js";
