import { Hono } from "hono";

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
}

const REQUIRED_STRING_FIELDS = ["user_id", "id", "type", "trace_id"] as const;

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

  router.get("/whoop/webhooks/ops", async (c) => {
    if (!options.enabled) {
      return c.json({ status: "disabled", enabled: false });
    }
    const ops = await options.store.getOpsStatus();
    const status = ops.failed > 0 || ops.processing > 0 ? "degraded" : "healthy";
    return c.json({ status, enabled: true, ...ops });
  });

  router.post("/webhooks/whoop", async (c) => {
    if (!options.enabled) {
      return c.json({ ok: false, error: "WHOOP webhook ingestion is disabled" }, 503 as never);
    }

    const rawBody = await c.req.text();
    if (Buffer.byteLength(rawBody, "utf8") > options.bodyLimitBytes) {
      return c.json({ ok: false, error: "request body too large" }, 413 as never);
    }

    const signatureResult = verifyWhoopWebhookSignature({
      rawBody,
      signature: c.req.header("X-WHOOP-Signature") ?? null,
      timestamp: c.req.header("X-WHOOP-Signature-Timestamp") ?? null,
      secret: options.secret,
      replayWindowSeconds: options.replayWindowSeconds,
      now: options.now?.(),
    });
    if (!signatureResult.ok) {
      return c.json({ ok: false, error: signatureResult.reason }, 401 as never);
    }

    const parsed = parsePayload(rawBody);
    if (!parsed.payload || !parsed.raw) {
      return c.json({ ok: false, error: parsed.error ?? "invalid payload" }, 400 as never);
    }

    const receivedAt = options.now?.() ?? new Date();
    const processAfter = new Date(receivedAt.getTime() + options.coalesceWindowMs);
    const result = await options.store.enqueueWebhookEvent({
      payload: parsed.payload,
      rawPayload: parsed.raw,
      receivedAt,
      processAfter,
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
