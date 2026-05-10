import { Pool, type QueryResultRow } from "pg";
import { PrismaClient, type WhoopWebhookIngressAudit as PrismaWhoopWebhookIngressAudit } from "@prisma/client";

import type {
  WhoopLiveEventArtifact,
  WhoopWebhookIngressAuditInput,
  WhoopWebhookIngressAuditRow,
  WhoopNotificationStatus,
  WhoopWebhookEnqueueResult,
  WhoopWebhookEventRow,
  WhoopWebhookPayload,
  WhoopWebhookStore,
} from "./webhook-types.js";

const ACTIVITY_TYPE_BY_PREFIX: Record<string, string> = {
  workout: "workout",
  sleep: "sleep",
  recovery: "recovery",
};

function activityTypeForEvent(eventType: string): string {
  const [prefix, action] = eventType.split(".");
  if (action === "deleted") return "delete";
  return ACTIVITY_TYPE_BY_PREFIX[prefix] ?? "unknown";
}

function compactPayload(payload: WhoopWebhookPayload): Record<string, unknown> {
  return {
    user_id: payload.user_id,
    id: payload.id,
    type: payload.type,
    trace_id: payload.trace_id,
  };
}

function mapEventRow(row: QueryResultRow): WhoopWebhookEventRow {
  return {
    id: String(row.id),
    traceId: String(row.trace_id),
    whoopUserId: String(row.whoop_user_id),
    eventType: String(row.event_type),
    resourceId: String(row.resource_id),
    status: row.status,
    receivedAt: row.received_at instanceof Date ? row.received_at : new Date(String(row.received_at)),
    processAfter: row.process_after ? (row.process_after instanceof Date ? row.process_after : new Date(String(row.process_after))) : null,
    attemptCount: Number(row.attempt_count ?? 0),
    lastError: row.last_error == null ? null : String(row.last_error),
    payloadCompact: typeof row.payload_compact === "object" && row.payload_compact ? row.payload_compact as Record<string, unknown> : {},
  };
}

function truncateError(error: string): string {
  return error.slice(0, 2000);
}

function truncateAuditValue(value: string | null): string | null {
  return value ? value.slice(0, 200) : null;
}

function mapIngressAuditRow(row: PrismaWhoopWebhookIngressAudit): WhoopWebhookIngressAuditRow {
  return {
    id: row.id,
    receivedAt: row.receivedAt,
    status: row.status === "accepted" ? "accepted" : "rejected",
    reason: row.reason,
    eventType: row.eventType,
    traceId: row.traceId,
    resourceId: row.resourceId,
    bodyBytes: row.bodyBytes,
    signaturePresent: row.signaturePresent,
    timestampPresent: row.timestampPresent,
  };
}

export class PostgresWhoopWebhookStore implements WhoopWebhookStore {
  private readonly pool: Pool;
  private readonly prisma: PrismaClient;
  private readonly ownsPool: boolean;
  private readonly ownsPrisma: boolean;

  constructor(connectionString: string, pool?: Pool, prisma?: PrismaClient) {
    this.pool = pool ?? new Pool({ connectionString });
    this.prisma = prisma ?? new PrismaClient({
      datasources: { db: { url: connectionString } },
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
    this.ownsPool = !pool;
    this.ownsPrisma = !prisma;
  }

  async enqueueWebhookEvent(input: {
    payload: WhoopWebhookPayload;
    rawPayload: Record<string, unknown>;
    receivedAt: Date;
    processAfter: Date;
  }): Promise<WhoopWebhookEnqueueResult> {
    const insert = await this.pool.query(
      `
      INSERT INTO whoop_webhook_events (
        trace_id,
        whoop_user_id,
        event_type,
        resource_id,
        received_at,
        process_after,
        signature_valid,
        payload_compact,
        raw_payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, true, $7::jsonb, $8::jsonb)
      ON CONFLICT (trace_id) DO NOTHING
      RETURNING *
      `,
      [
        input.payload.trace_id,
        input.payload.user_id,
        input.payload.type,
        input.payload.id,
        input.receivedAt,
        input.processAfter,
        JSON.stringify(compactPayload(input.payload)),
        JSON.stringify(input.rawPayload),
      ],
    );

    if (insert.rowCount === 1) {
      const event = mapEventRow(insert.rows[0]);
      await this.upsertActivity({
        triggerKey: `webhook:${event.traceId}`,
        source: "webhook",
        activityType: activityTypeForEvent(event.eventType),
        resourceId: event.resourceId,
        status: "queued",
        traceId: event.traceId,
        summary: `${event.eventType} queued`,
        metadata: { event_type: event.eventType },
      });
      return { status: "queued", event };
    }

    const existing = await this.pool.query("SELECT * FROM whoop_webhook_events WHERE trace_id = $1", [input.payload.trace_id]);
    return { status: "duplicate", event: mapEventRow(existing.rows[0]) };
  }

  async claimDueEvents(limit: number): Promise<WhoopWebhookEventRow[]> {
    const result = await this.pool.query(
      `
      UPDATE whoop_webhook_events
      SET
        status = 'processing',
        attempt_count = attempt_count + 1,
        processing_started_at = now(),
        updated_at = now()
      WHERE id IN (
        SELECT id
        FROM whoop_webhook_events
        WHERE status = 'queued'
          AND COALESCE(process_after, received_at) <= now()
        ORDER BY received_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
      `,
      [limit],
    );

    return result.rows.map(mapEventRow);
  }

  async coalesceQueuedSiblings(event: WhoopWebhookEventRow): Promise<number> {
    const result = await this.pool.query(
      `
      UPDATE whoop_webhook_events
      SET
        status = 'coalesced',
        coalesced_into_trace_id = $1,
        updated_at = now()
      WHERE trace_id <> $1
        AND status = 'queued'
        AND event_type = $2
        AND resource_id = $3
        AND received_at <= now()
      RETURNING trace_id
      `,
      [event.traceId, event.eventType, event.resourceId],
    );

    for (const row of result.rows) {
      await this.upsertActivity({
        triggerKey: `webhook:${row.trace_id}`,
        source: "webhook",
        activityType: activityTypeForEvent(event.eventType),
        resourceId: event.resourceId,
        status: "coalesced",
        traceId: String(row.trace_id),
        summary: `${event.eventType} coalesced`,
        metadata: { coalesced_into_trace_id: event.traceId },
      });
    }

    return result.rowCount ?? 0;
  }

  async recordAnalysis(input: {
    event: WhoopWebhookEventRow;
    artifact: WhoopLiveEventArtifact;
    notificationCandidate: boolean;
    notificationStatus: WhoopNotificationStatus;
    telegramMessageId?: string | null;
    error?: string | null;
  }): Promise<void> {
    const result = await this.pool.query(
      `
      INSERT INTO whoop_event_analysis (
        trace_id,
        schema_version,
        source,
        artifact,
        notification_candidate,
        notification_status,
        telegram_message_id,
        notified_at,
        error
      )
      VALUES ($1, $2, 'webhook', $3::jsonb, $4, $5, $6, CASE WHEN $5 = 'sent' THEN now() ELSE NULL END, $7)
      ON CONFLICT (trace_id) DO UPDATE SET
        artifact = EXCLUDED.artifact,
        notification_candidate = EXCLUDED.notification_candidate,
        notification_status = EXCLUDED.notification_status,
        telegram_message_id = EXCLUDED.telegram_message_id,
        notified_at = EXCLUDED.notified_at,
        error = EXCLUDED.error,
        updated_at = now()
      RETURNING id
      `,
      [
        input.event.traceId,
        input.artifact.schema_version,
        JSON.stringify(input.artifact),
        input.notificationCandidate,
        input.notificationStatus,
        input.telegramMessageId ?? null,
        input.error ? truncateError(input.error) : null,
      ],
    );

    const analysisId = result.rows[0]?.id ? String(result.rows[0].id) : null;
    await this.upsertActivity({
      triggerKey: `webhook:${input.event.traceId}`,
      source: "webhook",
      activityType: input.artifact.activity_type,
      resourceId: input.event.resourceId,
      status: input.notificationStatus === "sent" ? "sent" : input.notificationStatus === "no_reply" ? "no_reply" : input.notificationStatus,
      traceId: input.event.traceId,
      analysisId,
      summary: input.artifact.summary.headline,
      metadata: {
        event_type: input.event.eventType,
        policy_decision: input.artifact.policy.decision,
        policy_reason: input.artifact.policy.reason,
        telegram_message_id: input.telegramMessageId ?? null,
        error: input.error ?? null,
      },
    });
  }

  async markEventProcessed(traceId: string): Promise<void> {
    await this.pool.query(
      `
      UPDATE whoop_webhook_events
      SET status = 'processed', processed_at = now(), last_error = NULL, updated_at = now()
      WHERE trace_id = $1
      `,
      [traceId],
    );
  }

  async markEventFailed(traceId: string, error: string): Promise<void> {
    await this.pool.query(
      `
      UPDATE whoop_webhook_events
      SET status = 'failed', last_error = $2, updated_at = now()
      WHERE trace_id = $1
      `,
      [traceId, truncateError(error)],
    );
    await this.pool.query(
      `
      UPDATE whoop_activity_log
      SET status = 'failed', summary = $2, updated_at = now()
      WHERE trigger_key = $1
      `,
      [`webhook:${traceId}`, truncateError(error)],
    );
  }

  async getOpsStatus(): Promise<{
    queued: number;
    processing: number;
    failed: number;
    sent: number;
    noReply: number;
    oldestQueuedAt: string | null;
    latestFailure: string | null;
    ingressAccepted24h: number;
    ingressRejected24h: number;
    latestRejectedIngressAt: string | null;
    latestRejectedIngressReason: string | null;
    recentIngressAttempts: WhoopWebhookIngressAuditRow[];
  }> {
    const eventCounts = await this.pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
        COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        MIN(received_at) FILTER (WHERE status = 'queued') AS oldest_queued_at,
        (
          SELECT last_error
          FROM whoop_webhook_events
          WHERE status = 'failed' AND last_error IS NOT NULL
          ORDER BY updated_at DESC
          LIMIT 1
        ) AS latest_failure
      FROM whoop_webhook_events
      `,
    );
    const notificationCounts = await this.pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE notification_status = 'sent')::int AS sent,
        COUNT(*) FILTER (WHERE notification_status = 'no_reply')::int AS no_reply
      FROM whoop_event_analysis
      `,
    );
    const eventRow = eventCounts.rows[0] ?? {};
    const notificationRow = notificationCounts.rows[0] ?? {};
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [ingressAccepted24h, ingressRejected24h, latestRejectedIngress, recentIngressAttempts] = await Promise.all([
      this.prisma.whoopWebhookIngressAudit.count({
        where: {
          status: "accepted",
          receivedAt: { gte: last24h },
        },
      }),
      this.prisma.whoopWebhookIngressAudit.count({
        where: {
          status: "rejected",
          receivedAt: { gte: last24h },
        },
      }),
      this.prisma.whoopWebhookIngressAudit.findFirst({
        where: { status: "rejected" },
        orderBy: { receivedAt: "desc" },
        select: { receivedAt: true, reason: true },
      }),
      this.prisma.whoopWebhookIngressAudit.findMany({
        orderBy: { receivedAt: "desc" },
        take: 10,
      }),
    ]);
    const oldestQueuedAt = eventRow.oldest_queued_at
      ? (eventRow.oldest_queued_at instanceof Date ? eventRow.oldest_queued_at : new Date(String(eventRow.oldest_queued_at))).toISOString()
      : null;

    return {
      queued: Number(eventRow.queued ?? 0),
      processing: Number(eventRow.processing ?? 0),
      failed: Number(eventRow.failed ?? 0),
      sent: Number(notificationRow.sent ?? 0),
      noReply: Number(notificationRow.no_reply ?? 0),
      oldestQueuedAt,
      latestFailure: eventRow.latest_failure == null ? null : String(eventRow.latest_failure),
      ingressAccepted24h,
      ingressRejected24h,
      latestRejectedIngressAt: latestRejectedIngress?.receivedAt.toISOString() ?? null,
      latestRejectedIngressReason: latestRejectedIngress?.reason ?? null,
      recentIngressAttempts: recentIngressAttempts.map(mapIngressAuditRow),
    };
  }

  async recordIngressAttempt(input: WhoopWebhookIngressAuditInput): Promise<void> {
    await this.prisma.whoopWebhookIngressAudit.create({
      data: {
        receivedAt: input.receivedAt,
        status: input.status,
        reason: truncateAuditValue(input.reason),
        eventType: truncateAuditValue(input.eventType),
        traceId: truncateAuditValue(input.traceId),
        resourceId: truncateAuditValue(input.resourceId),
        bodyBytes: input.bodyBytes,
        signaturePresent: input.signaturePresent,
        timestampPresent: input.timestampPresent,
      },
    });
  }

  async trimRawPayloads(retentionDays: number): Promise<void> {
    await this.pool.query(
      `
      UPDATE whoop_webhook_events
      SET raw_payload = NULL, updated_at = now()
      WHERE raw_payload IS NOT NULL
        AND received_at < now() - ($1::text || ' days')::interval
      `,
      [retentionDays],
    );
  }

  async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
    if (this.ownsPrisma) {
      await this.prisma.$disconnect();
    }
  }

  private async upsertActivity(input: {
    triggerKey: string;
    source: string;
    activityType: string;
    resourceId: string | null;
    status: string;
    traceId?: string | null;
    analysisId?: string | null;
    summary: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO whoop_activity_log (
        trigger_key,
        source,
        activity_type,
        resource_id,
        status,
        trace_id,
        analysis_id,
        summary,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      ON CONFLICT (trigger_key) DO UPDATE SET
        status = EXCLUDED.status,
        analysis_id = COALESCE(EXCLUDED.analysis_id, whoop_activity_log.analysis_id),
        summary = EXCLUDED.summary,
        metadata = EXCLUDED.metadata,
        updated_at = now()
      `,
      [
        input.triggerKey,
        input.source,
        input.activityType,
        input.resourceId,
        input.status,
        input.traceId ?? null,
        input.analysisId ?? null,
        input.summary,
        JSON.stringify(input.metadata),
      ],
    );
  }
}
