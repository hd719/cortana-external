import type { Hono } from "hono";

import type { WhoopFactoryConfig } from "./types.js";
import { createWhoopRouter } from "./routes.js";
import { WhoopService } from "./service.js";
import { PostgresWhoopWebhookStore } from "./webhook-store.js";
import { TelegramWhoopNotifier } from "./webhook-telegram.js";
import { WhoopWebhookProcessor } from "./webhook-processor.js";
import type { AppConfig } from "../config.js";

const isEnabled = (value: string | undefined) => ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());

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

export type WhoopWebhookRuntime = {
  store: PostgresWhoopWebhookStore;
  processor: WhoopWebhookProcessor;
  enabled: boolean;
  secret: string;
  replayWindowSeconds: number;
  bodyLimitBytes: number;
  coalesceWindowMs: number;
};

export function createWhoopWebhookRuntime(config: AppConfig, service: WhoopService): WhoopWebhookRuntime | null {
  const enabled = isEnabled(config.WHOOP_WEBHOOK_ENABLED);
  if (!enabled) {
    return null;
  }

  const store = new PostgresWhoopWebhookStore(config.CORTANA_DATABASE_URL);
  const notifier = new TelegramWhoopNotifier({
    enabled: isEnabled(config.WHOOP_LIVE_EVENT_TELEGRAM_ENABLED),
    accountId: config.WHOOP_LIVE_EVENT_TELEGRAM_ACCOUNT_ID,
  });
  const processor = new WhoopWebhookProcessor(store, service, notifier, {
    enabled,
    coalesceWindowMs: config.WHOOP_WEBHOOK_COALESCE_WINDOW_MS,
    intervalMs: config.WHOOP_WEBHOOK_PROCESSOR_INTERVAL_MS,
    batchSize: config.WHOOP_WEBHOOK_PROCESS_BATCH_SIZE,
    rawRetentionDays: config.WHOOP_WEBHOOK_RAW_RETENTION_DAYS,
  });

  return {
    store,
    processor,
    enabled,
    secret: config.WHOOP_WEBHOOK_SECRET,
    replayWindowSeconds: config.WHOOP_WEBHOOK_REPLAY_WINDOW_SECONDS,
    bodyLimitBytes: config.WHOOP_WEBHOOK_BODY_LIMIT_BYTES,
    coalesceWindowMs: config.WHOOP_WEBHOOK_COALESCE_WINDOW_MS,
  };
}

export function registerWhoopRoutes(app: Hono, service: WhoopService, webhook?: WhoopWebhookRuntime | null): void {
  app.route("/", createWhoopRouter(service, webhook
    ? {
        enabled: webhook.enabled,
        secret: webhook.secret,
        replayWindowSeconds: webhook.replayWindowSeconds,
        bodyLimitBytes: webhook.bodyLimitBytes,
        coalesceWindowMs: webhook.coalesceWindowMs,
        store: webhook.store,
        processor: webhook.processor,
      }
    : undefined));
}

export { WhoopService };
