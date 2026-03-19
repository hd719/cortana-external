import { Hono } from "hono";

import { createAlpacaService, registerAlpacaRoutes, type AlpacaService } from "./alpaca/index.js";
import { createAppleHealthService, registerAppleHealthRoutes, type AppleHealthService } from "./apple-health/index.js";
import { getConfig } from "./config.js";
import { buildAggregateHealth } from "./health.js";
import { createLogger } from "./lib/logger.js";
import { createTonalService, registerTonalRoutes, type TonalService } from "./tonal/index.js";
import { createWhoopService, registerWhoopRoutes, type WhoopService } from "./whoop/index.js";

export interface ExternalServices {
  whoop: WhoopService;
  tonal: TonalService;
  alpaca: AlpacaService;
  appleHealth: AppleHealthService;
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
  return {
    whoop: createWhoopService(config),
    tonal: createTonalService(config),
    alpaca: createAlpacaService({ logger: createLogger("alpaca") }),
    appleHealth: createAppleHealthService(config),
  };
}

export function createApplication(services: ExternalServices = createExternalServices()): {
  app: Hono;
  services: ExternalServices;
} {
  const app = new Hono();

  registerWhoopRoutes(app, services.whoop);
  registerTonalRoutes(app, services.tonal);
  registerAlpacaRoutes(app, services.alpaca);
  registerAppleHealthRoutes(app, services.appleHealth);

  app.get("/health", async (c) => {
    const { signal, cancel } = createHealthSignal(10_000);

    try {
      const [whoop, tonal, alpaca, appleHealth] = await Promise.all([
        services.whoop.getAggregateHealth().catch(toUnhealthyPayload),
        services.tonal.getAggregateHealth(signal).catch(toUnhealthyPayload),
        services.alpaca.checkHealth().catch(toUnhealthyPayload),
        services.appleHealth.getHealth().catch(toUnhealthyPayload),
      ]);

      const result = buildAggregateHealth({ whoop, tonal, alpaca, appleHealth });
      return c.json(
        {
          status: result.status,
          whoop: result.whoop,
          tonal: result.tonal,
          alpaca: result.alpaca,
          appleHealth: result.appleHealth,
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
