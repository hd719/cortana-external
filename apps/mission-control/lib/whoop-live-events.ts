import { Pool } from "pg";

export type WhoopLiveEventStatus =
  | "queued"
  | "processed"
  | "failed"
  | "no_reply"
  | "sent"
  | "coalesced"
  | string;

export type WhoopLiveEventSource = "webhook" | "cron" | "manual" | string;

export type WhoopLiveEvent = {
  id: string;
  triggerKey: string;
  source: WhoopLiveEventSource;
  activityType: string;
  resourceId: string | null;
  status: WhoopLiveEventStatus;
  traceId: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type WhoopLiveEventsResponse = {
  events: WhoopLiveEvent[];
  warning?: string;
};

type ActivityRow = {
  id: string;
  trigger_key: string;
  source: string;
  activity_type: string;
  resource_id: string | null;
  status: string;
  trace_id: string | null;
  summary: string | null;
  metadata: unknown;
  created_at: Date;
  updated_at: Date;
};

const globalForWhoopLiveEvents = globalThis as typeof globalThis & {
  whoopLiveEventsPool?: Pool;
  whoopLiveEventsPoolUrl?: string;
};

function databaseUrl(): string {
  return process.env.CORTANA_DATABASE_URL?.trim()
    || process.env.DATABASE_URL?.trim()
    || "postgresql://localhost:5432/cortana";
}

function getPool(): Pool {
  const url = databaseUrl();
  if (!globalForWhoopLiveEvents.whoopLiveEventsPool || globalForWhoopLiveEvents.whoopLiveEventsPoolUrl !== url) {
    globalForWhoopLiveEvents.whoopLiveEventsPool = new Pool({ connectionString: url });
    globalForWhoopLiveEvents.whoopLiveEventsPoolUrl = url;
  }
  return globalForWhoopLiveEvents.whoopLiveEventsPool;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function mapRow(row: ActivityRow): WhoopLiveEvent {
  return {
    id: row.id,
    triggerKey: row.trigger_key,
    source: row.source,
    activityType: row.activity_type,
    resourceId: row.resource_id,
    status: row.status,
    traceId: row.trace_id,
    summary: row.summary,
    metadata: normalizeMetadata(row.metadata),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function loadWhoopLiveEvents(input?: {
  limit?: number;
  source?: string | null;
  status?: string | null;
}): Promise<WhoopLiveEventsResponse> {
  const limit = Math.max(1, Math.min(100, input?.limit ?? 20));
  const values: unknown[] = [];
  const filters: string[] = [];

  if (input?.source && input.source !== "all") {
    values.push(input.source);
    filters.push(`source = $${values.length}`);
  }
  if (input?.status && input.status !== "all") {
    values.push(input.status);
    filters.push(`status = $${values.length}`);
  }
  values.push(limit);

  try {
    const result = await getPool().query<ActivityRow>(
      `
      SELECT
        id::text,
        trigger_key,
        source,
        activity_type,
        resource_id,
        status,
        trace_id,
        summary,
        metadata,
        created_at,
        updated_at
      FROM whoop_activity_log
      ${filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT $${values.length}
      `,
      values,
    );

    return { events: result.rows.map(mapRow) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("whoop_activity_log") || message.includes("does not exist")) {
      return {
        events: [],
        warning: "WHOOP Live Events tables are not migrated yet.",
      };
    }
    throw error;
  }
}

export async function requeueWhoopWebhookEvent(traceId: string, reason: string): Promise<{ ok: true; status: "queued" }> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const update = await client.query(
      `
      UPDATE whoop_webhook_events
      SET
        status = 'queued',
        process_after = now(),
        processing_started_at = NULL,
        processed_at = NULL,
        last_error = NULL,
        updated_at = now()
      WHERE trace_id = $1
        AND status IN ('failed', 'processed', 'coalesced', 'ignored')
      RETURNING trace_id
      `,
      [traceId],
    );

    if (update.rowCount === 0) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("WHOOP event is not eligible for reprocess"), { statusCode: 409 });
    }

    await client.query(
      `
      UPDATE whoop_activity_log
      SET
        status = 'queued',
        summary = 'Requeued for processing',
        metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
        updated_at = now()
      WHERE trigger_key = $1
      `,
      [`webhook:${traceId}`, JSON.stringify({ reprocess_reason: reason })],
    );
    await client.query("COMMIT");
    return { ok: true, status: "queued" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
