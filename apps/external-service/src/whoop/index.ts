import type { Hono } from "hono";

import type { WhoopFactoryConfig } from "./types.js";
import { createWhoopRouter } from "./routes.js";
import { WhoopService } from "./service.js";

export function createWhoopService(config: WhoopFactoryConfig, overrides?: { fetchImpl?: typeof fetch }): WhoopService {
  return new WhoopService({
    clientId: config.WHOOP_CLIENT_ID,
    clientSecret: config.WHOOP_CLIENT_SECRET,
    redirectUrl: config.WHOOP_REDIRECT_URL,
    tokenPath: config.WHOOP_TOKEN_PATH,
    dataPath: config.WHOOP_DATA_PATH,
    fetchImpl: overrides?.fetchImpl,
  });
}

export function registerWhoopRoutes(app: Hono, service: WhoopService): void {
  app.route("/", createWhoopRouter(service));
}

export { WhoopService };
