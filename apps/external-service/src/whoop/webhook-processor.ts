import { createLogger, type AppLogger } from "../lib/logger.js";
import type {
  WhoopLiveEventArtifact,
  WhoopSnapshotProvider,
  WhoopTelegramNotifier,
  WhoopWebhookEventRow,
  WhoopWebhookProcessorOptions,
  WhoopWebhookStore,
} from "./webhook-types.js";
import type { WhoopData } from "./types.js";

type JsonRecord = Record<string, unknown>;

const UPDATE_EVENTS = new Set(["workout.updated", "sleep.updated", "recovery.updated"]);

function getPath(record: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, record);
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function pickNumber(record: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const parsed = parseNumber(getPath(record, path));
    if (parsed != null) return parsed;
  }
  return null;
}

function pickDate(record: unknown, paths: string[]): Date | null {
  for (const path of paths) {
    const parsed = parseDate(getPath(record, path));
    if (parsed) return parsed;
  }
  return null;
}

function latestRecord(records: JsonRecord[]): JsonRecord | null {
  const ordered = records
    .map((record) => ({
      record,
      date: pickDate(record, ["updated_at", "end", "start", "score_state", "created_at", "timestamp"]),
    }))
    .filter((item): item is { record: JsonRecord; date: Date } => Boolean(item.date))
    .sort((left, right) => right.date.getTime() - left.date.getTime());
  return ordered[0]?.record ?? records[0] ?? null;
}

function findResourceRecord(records: JsonRecord[], resourceId: string): JsonRecord | null {
  return records.find((record) => String(record.id ?? record.workout_id ?? record.sleep_id ?? "") === resourceId) ?? latestRecord(records);
}

function activityTypeForEvent(eventType: string): string {
  const [prefix, action] = eventType.split(".");
  if (action === "deleted") return "delete";
  if (prefix === "workout" || prefix === "sleep" || prefix === "recovery") return prefix;
  return "unknown";
}

function headlineFor(event: WhoopWebhookEventRow): string {
  const activityType = activityTypeForEvent(event.eventType);
  if (activityType === "delete") return `${event.eventType} recorded`;
  if (activityType === "workout") return "Workout updated";
  if (activityType === "sleep") return "Sleep updated";
  if (activityType === "recovery") return "Recovery updated";
  return "WHOOP event processed";
}

function buildArtifact(event: WhoopWebhookEventRow, snapshot: WhoopData, coalescedCount: number): WhoopLiveEventArtifact {
  const workout = findResourceRecord(snapshot.workouts as JsonRecord[], event.resourceId);
  const sleep = findResourceRecord(snapshot.sleep as JsonRecord[], event.resourceId);
  const recovery = findResourceRecord(snapshot.recovery as JsonRecord[], event.resourceId);
  const activityType = activityTypeForEvent(event.eventType);
  const isMessageCandidate = UPDATE_EVENTS.has(event.eventType);
  const signalCount = [
    pickNumber(workout, ["score.strain", "strain"]),
    pickNumber(recovery, ["score.recovery_score", "score", "recovery_score"]),
    pickNumber(sleep, ["score.sleep_performance_percentage", "score.sleep_performance", "sleep_performance"]),
  ].filter((value) => value != null).length;

  return {
    schema_version: "whoop_event_analysis.v1",
    source: "webhook",
    trace_id: event.traceId,
    event_type: event.eventType,
    resource_id: event.resourceId,
    activity_type: activityType,
    observed_at: event.receivedAt.toISOString(),
    snapshot_fetched_at: new Date().toISOString(),
    summary: {
      headline: headlineFor(event),
      changed_subject: activityType === "delete" ? "deleted WHOOP resource" : `latest WHOOP ${activityType}`,
      readiness_context: signalCount > 0 ? "available" : "limited",
    },
    signals: {
      strain: pickNumber(workout, ["score.strain", "strain"]),
      workout_duration_seconds: pickNumber(workout, ["score.workout_duration", "duration", "duration_seconds"]),
      avg_heart_rate: pickNumber(workout, ["score.average_heart_rate", "average_heart_rate", "avg_heart_rate"]),
      max_heart_rate: pickNumber(workout, ["score.max_heart_rate", "max_heart_rate"]),
      recovery_score: pickNumber(recovery, ["score.recovery_score", "score", "recovery_score"]),
      sleep_performance: pickNumber(sleep, ["score.sleep_performance_percentage", "score.sleep_performance", "sleep_performance"]),
      hrv: pickNumber(recovery, ["score.hrv_rmssd_milli", "hrv_rmssd_milli", "hrv"]),
      resting_hr: pickNumber(recovery, ["score.resting_heart_rate", "resting_heart_rate"]),
    },
    policy: {
      decision: isMessageCandidate ? "SEND" : "NO_REPLY",
      reason: isMessageCandidate
        ? "Fresh WHOOP update is ready for Spartan coaching."
        : "Delete or unsupported event retained for audit without coaching.",
    },
    debug: {
      coalesced_count: coalescedCount,
      processor_attempt: event.attemptCount,
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class WhoopWebhookProcessor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly logger: AppLogger;

  constructor(
    private readonly store: WhoopWebhookStore,
    private readonly snapshotProvider: WhoopSnapshotProvider,
    private readonly notifier: WhoopTelegramNotifier,
    private readonly options: WhoopWebhookProcessorOptions,
    logger: AppLogger = createLogger("whoop-webhook"),
  ) {
    this.logger = logger;
  }

  start(): void {
    if (!this.options.enabled || this.timer) return;
    this.timer = setInterval(() => {
      void this.processDueEvents().catch((error) => this.logger.error("processor tick failed", error));
    }, this.options.intervalMs);
    void this.processDueEvents().catch((error) => this.logger.error("initial processor tick failed", error));
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processDueEvents(): Promise<number> {
    if (!this.options.enabled || this.running) return 0;
    this.running = true;
    let processed = 0;
    try {
      const events = await this.store.claimDueEvents(this.options.batchSize);
      for (const event of events) {
        await this.processEvent(event);
        processed += 1;
      }
      if (processed > 0) {
        await this.store.trimRawPayloads(this.options.rawRetentionDays);
      }
      return processed;
    } finally {
      this.running = false;
    }
  }

  private async processEvent(event: WhoopWebhookEventRow): Promise<void> {
    try {
      const coalescedCount = await this.store.coalesceQueuedSiblings(event);
      const { data } = await this.snapshotProvider.getWhoopData(true);
      const artifact = buildArtifact(event, data, coalescedCount);
      const notificationCandidate = artifact.policy.decision === "SEND";
      const telegramResult = notificationCandidate
        ? await this.notifier.sendLiveEventMessage(artifact)
        : { status: "no_reply" as const };

      await this.store.recordAnalysis({
        event,
        artifact,
        notificationCandidate,
        notificationStatus: telegramResult.status,
        telegramMessageId: telegramResult.telegramMessageId ?? null,
        error: telegramResult.error ?? null,
      });
      await this.store.markEventProcessed(event.traceId);
      if (telegramResult.status === "sent") {
        this.logger.log(`sent Spartan Telegram message for ${event.traceId}`);
      }
    } catch (error) {
      await this.store.markEventFailed(event.traceId, errorMessage(error));
      this.logger.error(`failed to process ${event.traceId}`, error);
    }
  }
}

export const whoopWebhookProcessorInternalsForTests = {
  buildArtifact,
};
