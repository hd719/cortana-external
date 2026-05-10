import { Hono } from "hono";

import { createLogger, type AppLogger } from "../lib/logger.js";
import { verifyWhoopWebhookSignature } from "./webhook-signature.js";
import type {
  WhoopWebhookPayload,
  WhoopWebhookProcessorOptions,
  WhoopWebhookStore,
} from "./webhook-types.js";

export interface WhoopWebhookRouteOptions {
  enabled: boolean;
  secret: string;
  replayWindowSeconds: number;
  bodyLimitBytes: number;
  coalesceWindowMs: number;
  store: WhoopWebhookStore;
  processor?: {
    processDueEvents(): Promise<number>;
  };
  now?: () => Date;
  logger?: AppLogger;
}

const REQUIRED_STRING_FIELDS = ["user_id", "id", "type", "trace_id"] as const;
const DEFAULT_LOGGER = createLogger("whoop-webhook-ingress");

function safeLogValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.slice(0, 120) : null;
}

async function recordWebhookAttempt(store: WhoopWebhookStore, logger: AppLogger, input: {
  receivedAt: Date;
  status: "accepted" | "rejected";
  reason?: string;
  eventType?: unknown;
  traceId?: unknown;
  resourceId?: unknown;
  bodyBytes: number;
  signaturePresent: boolean;
  timestampPresent: boolean;
}): Promise<void> {
  const audit = {
    receivedAt: input.receivedAt,
    status: input.status,
    reason: input.reason ?? null,
    event_type: safeLogValue(input.eventType),
    trace_id: safeLogValue(input.traceId),
    resource_id: safeLogValue(input.resourceId),
    body_bytes: input.bodyBytes,
    signature_present: input.signaturePresent,
    timestamp_present: input.timestampPresent,
  };
  logger.log(JSON.stringify(audit));

  try {
    await store.recordIngressAttempt({
      receivedAt: input.receivedAt,
      status: input.status,
      reason: input.reason ?? null,
      eventType: audit.event_type,
      traceId: audit.trace_id,
      resourceId: audit.resource_id,
      bodyBytes: input.bodyBytes,
      signaturePresent: input.signaturePresent,
      timestampPresent: input.timestampPresent,
    });
  } catch (error) {
    logger.error("failed to persist WHOOP webhook ingress audit", error);
  }
}

function parsePayload(rawBody: string): { payload?: WhoopWebhookPayload; error?: string; raw?: Record<string, unknown> } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { error: "invalid JSON body" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "webhook body must be an object" };
  }

  const record = parsed as Record<string, unknown>;
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof record[field] !== "string" || !record[field].trim()) {
      return { error: `missing ${field}` };
    }
  }

  return {
    payload: {
      user_id: String(record.user_id),
      id: String(record.id),
      type: String(record.type),
      trace_id: String(record.trace_id),
    },
    raw: record,
  };
}

export function createWhoopWebhookRouter(options: WhoopWebhookRouteOptions): Hono {
  const router = new Hono();
  const logger = options.logger ?? DEFAULT_LOGGER;

  router.get("/whoop/webhooks/ops", async (c) => {
    if (!options.enabled) {
      return c.json({ status: "disabled", enabled: false });
    }
    const ops = await options.store.getOpsStatus();
    const status = ops.failed > 0 || ops.processing > 0 ? "degraded" : "healthy";
    return c.json({ status, enabled: true, ...ops });
  });

  router.post("/webhooks/whoop", async (c) => {
    const signature = c.req.header("X-WHOOP-Signature") ?? null;
    const timestamp = c.req.header("X-WHOOP-Signature-Timestamp") ?? null;
    const receivedAt = options.now?.() ?? new Date();

    if (!options.enabled) {
      await recordWebhookAttempt(options.store, logger, {
        receivedAt,
        status: "rejected",
        reason: "disabled",
        bodyBytes: 0,
        signaturePresent: Boolean(signature),
        timestampPresent: Boolean(timestamp),
      });
      return c.json({ ok: false, error: "WHOOP webhook ingestion is disabled" }, 503 as never);
    }

    const rawBody = await c.req.text();
    const bodyBytes = Buffer.byteLength(rawBody, "utf8");
    if (bodyBytes > options.bodyLimitBytes) {
      await recordWebhookAttempt(options.store, logger, {
        receivedAt,
        status: "rejected",
        reason: "body_too_large",
        bodyBytes,
        signaturePresent: Boolean(signature),
        timestampPresent: Boolean(timestamp),
      });
      return c.json({ ok: false, error: "request body too large" }, 413 as never);
    }

    const signatureResult = verifyWhoopWebhookSignature({
      rawBody,
      signature,
      timestamp,
      secret: options.secret,
      replayWindowSeconds: options.replayWindowSeconds,
      now: options.now?.(),
    });
    const parsed = parsePayload(rawBody);
    if (!signatureResult.ok) {
      await recordWebhookAttempt(options.store, logger, {
        receivedAt,
        status: "rejected",
        reason: signatureResult.reason,
        eventType: parsed.raw?.type,
        traceId: parsed.raw?.trace_id,
        resourceId: parsed.raw?.id,
        bodyBytes,
        signaturePresent: Boolean(signature),
        timestampPresent: Boolean(timestamp),
      });
      return c.json({ ok: false, error: signatureResult.reason }, 401 as never);
    }

    if (!parsed.payload || !parsed.raw) {
      await recordWebhookAttempt(options.store, logger, {
        receivedAt,
        status: "rejected",
        reason: parsed.error ?? "invalid_payload",
        eventType: parsed.raw?.type,
        traceId: parsed.raw?.trace_id,
        resourceId: parsed.raw?.id,
        bodyBytes,
        signaturePresent: Boolean(signature),
        timestampPresent: Boolean(timestamp),
      });
      return c.json({ ok: false, error: parsed.error ?? "invalid payload" }, 400 as never);
    }

    const processAfter = new Date(receivedAt.getTime() + options.coalesceWindowMs);
    const result = await options.store.enqueueWebhookEvent({
      payload: parsed.payload,
      rawPayload: parsed.raw,
      receivedAt,
      processAfter,
    });
    await recordWebhookAttempt(options.store, logger, {
      receivedAt,
      status: "accepted",
      reason: result.status,
      eventType: parsed.payload.type,
      traceId: parsed.payload.trace_id,
      resourceId: parsed.payload.id,
      bodyBytes,
      signaturePresent: Boolean(signature),
      timestampPresent: Boolean(timestamp),
    });

    if (options.coalesceWindowMs === 0) {
      void options.processor?.processDueEvents().catch(() => {});
    }

    return c.json({
      ok: true,
      status: result.status,
      trace_id: result.event.traceId,
    });
  });

  return router;
}

export function buildWhoopWebhookProcessorOptions(input: {
  enabled: boolean;
  coalesceWindowMs: number;
  intervalMs: number;
  batchSize: number;
  rawRetentionDays: number;
}): WhoopWebhookProcessorOptions {
  return {
    enabled: input.enabled,
    coalesceWindowMs: input.coalesceWindowMs,
    intervalMs: input.intervalMs,
    batchSize: input.batchSize,
    rawRetentionDays: input.rawRetentionDays,
  };
}
