import { Hono } from "hono";

import { createMarketDataService, registerMarketDataRoutes, type MarketDataService } from "./market-data/index.js";
import { createAlpacaService, registerAlpacaRoutes, type AlpacaService } from "./alpaca/index.js";
import { createAppleHealthService, registerAppleHealthRoutes, type AppleHealthService } from "./apple-health/index.js";
import { getConfig } from "./config.js";
import { buildAggregateHealth } from "./health.js";
import { createLogger } from "./lib/logger.js";
import { createPolymarketService, registerPolymarketRoutes, type PolymarketService } from "./polymarket/index.js";
import { createTonalService, registerTonalRoutes, type TonalService } from "./tonal/index.js";
import { createWhoopService, createWhoopWebhookRuntime, registerWhoopRoutes, type WhoopService, type WhoopWebhookRuntime } from "./whoop/index.js";

export interface ExternalServices {
  whoop: WhoopService;
  whoopWebhook?: WhoopWebhookRuntime | null;
  tonal: TonalService;
  alpaca: AlpacaService;
  appleHealth: AppleHealthService;
  marketData: MarketDataService;
  polymarket: PolymarketService;
}

function toUnhealthyPayload(error: unknown): Record<string, unknown> {
  return {
    status: "unhealthy",
    error: error instanceof Error ? error.message : String(error),
  };
}

function createHealthSignal(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timeout),
  };
}

export function createExternalServices(): ExternalServices {
  const config = getConfig();
  const whoop = createWhoopService(config);
  return {
    whoop,
    whoopWebhook: createWhoopWebhookRuntime(config, whoop),
    tonal: createTonalService(config),
    alpaca: createAlpacaService({ logger: createLogger("alpaca") }),
    appleHealth: createAppleHealthService(config),
    marketData: createMarketDataService(config),
    polymarket: createPolymarketService(config),
  };
}

export function createApplication(services: ExternalServices = createExternalServices()): {
  app: Hono;
  services: ExternalServices;
} {
  const app = new Hono();

  registerWhoopRoutes(app, services.whoop, services.whoopWebhook);
  registerTonalRoutes(app, services.tonal);
  registerAlpacaRoutes(app, services.alpaca);
  registerAppleHealthRoutes(app, services.appleHealth);
  registerMarketDataRoutes(app, services.marketData);
  registerPolymarketRoutes(app, services.polymarket);

  app.get("/health", async (c) => {
    const { signal, cancel } = createHealthSignal(10_000);

    try {
      const [whoop, tonal, alpaca, appleHealth, marketData, polymarket] = await Promise.all([
        services.whoop.getAggregateHealth().catch(toUnhealthyPayload),
        services.tonal.getAggregateHealth(signal).catch(toUnhealthyPayload),
        services.alpaca.checkHealth().catch(toUnhealthyPayload),
        services.appleHealth.handleHealth().then((result) => result.body).catch(toUnhealthyPayload),
        services.marketData.checkHealth().catch(toUnhealthyPayload),
        services.polymarket.checkHealth().catch(toUnhealthyPayload),
      ]);

      const result = buildAggregateHealth({ whoop, tonal, alpaca, appleHealth, marketData, polymarket });
      return c.json(
        {
          status: result.status,
          whoop: result.whoop,
          tonal: result.tonal,
          alpaca: result.alpaca,
          appleHealth: result.appleHealth,
          marketData: result.marketData,
          polymarket: result.polymarket,
        },
        result.statusCode as never,
      );
    } finally {
      cancel();
    }
  });

  return { app, services };
}

export function createApp(services?: ExternalServices): Hono {
  return createApplication(services).app;
}
