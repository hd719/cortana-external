import type { Hono } from "hono";

import { createLogger } from "../lib/logger.js";
import { resolveFromCwd } from "../lib/files.js";
import type { AppleHealthFactoryConfig } from "./types.js";
import { createAppleHealthRouter } from "./routes.js";
import { AppleHealthService } from "./service.js";

export function createAppleHealthService(config: AppleHealthFactoryConfig): AppleHealthService {
  return new AppleHealthService({
    token: config.APPLE_HEALTH_TOKEN,
    dataDir: resolveFromCwd(config.APPLE_HEALTH_DATA_DIR),
    logger: createLogger("apple-health"),
  });
}

export function registerAppleHealthRoutes(app: Hono, service: AppleHealthService): void {
  app.route("/", createAppleHealthRouter(service));
}

export { AppleHealthService };
export type { HealthTestPayload, HealthSyncPayload } from "./types.js";
