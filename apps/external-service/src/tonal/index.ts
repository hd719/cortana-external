import type { Hono } from "hono";

import type { AppConfig } from "../config.js";
import { createLogger } from "../lib/logger.js";
import { registerTonalRoutes as registerRoutes } from "./routes.js";
import { TonalService } from "./service.js";

export function createTonalService(config: AppConfig): TonalService {
  return new TonalService({
    email: config.TONAL_EMAIL,
    password: config.TONAL_PASSWORD,
    tokenPath: config.TONAL_TOKEN_PATH,
    dataPath: config.TONAL_DATA_PATH,
    requestDelayMs: 500,
    logger: createLogger("tonal"),
  });
}

export function registerTonalRoutes(app: Hono, service: TonalService): void {
  registerRoutes(app, service);
}

export { TonalService } from "./service.js";
