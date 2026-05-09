import type { WhoopData } from "./types.js";

export type WhoopWebhookEventType =
  | "workout.updated"
  | "workout.deleted"
  | "sleep.updated"
  | "sleep.deleted"
  | "recovery.updated"
  | "recovery.deleted"
  | string;

export interface WhoopWebhookPayload {
  user_id: string;
  id: string;
  type: WhoopWebhookEventType;
  trace_id: string;
}

export type WhoopWebhookEventStatus =
  | "queued"
  | "coalesced"
  | "processing"
  | "processed"
  | "failed"
  | "ignored";

export type WhoopNotificationStatus =
  | "no_reply"
  | "queued"
  | "sent"
  | "failed"
  | "monitor_only";

export interface WhoopWebhookEventRow {
  id: string;
  traceId: string;
  whoopUserId: string;
  eventType: string;
  resourceId: string;
  status: WhoopWebhookEventStatus;
  receivedAt: Date;
  processAfter: Date | null;
  attemptCount: number;
  lastError: string | null;
  payloadCompact: Record<string, unknown>;
}

export interface WhoopWebhookEnqueueResult {
  status: "queued" | "duplicate";
  event: WhoopWebhookEventRow;
}

export interface WhoopLiveEventArtifact {
  schema_version: "whoop_event_analysis.v1";
  source: "webhook";
  trace_id: string;
  event_type: string;
  resource_id: string;
  activity_type: string;
  observed_at: string;
  snapshot_fetched_at: string;
  summary: {
    headline: string;
    changed_subject: string;
    readiness_context: string;
  };
  signals: {
    strain: number | null;
    workout_duration_seconds: number | null;
    avg_heart_rate: number | null;
    max_heart_rate: number | null;
    recovery_score: number | null;
    sleep_performance: number | null;
    hrv: number | null;
    resting_hr: number | null;
  };
  policy: {
    decision: "SEND" | "NO_REPLY";
    reason: string;
  };
  debug: {
    coalesced_count: number;
    processor_attempt: number;
  };
}

export interface WhoopTelegramResult {
  status: WhoopNotificationStatus;
  telegramMessageId?: string;
  error?: string;
}

export interface WhoopTelegramNotifier {
  sendLiveEventMessage(artifact: WhoopLiveEventArtifact): Promise<WhoopTelegramResult>;
}

export interface WhoopWebhookStore {
  enqueueWebhookEvent(input: {
    payload: WhoopWebhookPayload;
    rawPayload: Record<string, unknown>;
    receivedAt: Date;
    processAfter: Date;
  }): Promise<WhoopWebhookEnqueueResult>;
  claimDueEvents(limit: number): Promise<WhoopWebhookEventRow[]>;
  coalesceQueuedSiblings(event: WhoopWebhookEventRow): Promise<number>;
  recordAnalysis(input: {
    event: WhoopWebhookEventRow;
    artifact: WhoopLiveEventArtifact;
    notificationCandidate: boolean;
    notificationStatus: WhoopNotificationStatus;
    telegramMessageId?: string | null;
    error?: string | null;
  }): Promise<void>;
  markEventProcessed(traceId: string): Promise<void>;
  markEventFailed(traceId: string, error: string): Promise<void>;
  getOpsStatus(): Promise<{
    queued: number;
    processing: number;
    failed: number;
    sent: number;
    noReply: number;
    oldestQueuedAt: string | null;
    latestFailure: string | null;
  }>;
  trimRawPayloads(retentionDays: number): Promise<void>;
  close?(): Promise<void>;
}

export interface WhoopWebhookProcessorOptions {
  enabled: boolean;
  coalesceWindowMs: number;
  intervalMs: number;
  batchSize: number;
  rawRetentionDays: number;
}

export interface WhoopSnapshotProvider {
  getWhoopData(forceFresh: boolean): Promise<{ data: WhoopData; servedStale: boolean }>;
}
