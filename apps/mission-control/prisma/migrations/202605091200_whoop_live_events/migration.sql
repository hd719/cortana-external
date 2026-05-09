CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "whoop_webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trace_id" TEXT NOT NULL,
    "whoop_user_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "process_after" TIMESTAMP(3),
    "processing_started_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "coalesced_into_trace_id" TEXT,
    "signature_valid" BOOLEAN NOT NULL DEFAULT true,
    "payload_compact" JSONB NOT NULL DEFAULT '{}',
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whoop_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whoop_event_analysis" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trace_id" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL DEFAULT 'whoop_event_analysis.v1',
    "source" TEXT NOT NULL,
    "artifact" JSONB NOT NULL,
    "notification_candidate" BOOLEAN NOT NULL DEFAULT false,
    "notification_status" TEXT NOT NULL DEFAULT 'no_reply',
    "spartan_session_key" TEXT,
    "telegram_message_id" TEXT,
    "notified_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whoop_event_analysis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whoop_activity_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trigger_key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "activity_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "status" TEXT NOT NULL,
    "trace_id" TEXT,
    "analysis_id" UUID,
    "summary" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whoop_activity_log_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whoop_webhook_events_trace_id_key" ON "whoop_webhook_events"("trace_id");
CREATE INDEX "whoop_webhook_events_status_process_after_received_at_idx" ON "whoop_webhook_events"("status", "process_after", "received_at");
CREATE INDEX "whoop_webhook_events_event_type_resource_id_received_at_idx" ON "whoop_webhook_events"("event_type", "resource_id", "received_at" DESC);
CREATE INDEX "whoop_webhook_events_received_at_idx" ON "whoop_webhook_events"("received_at" DESC);

CREATE UNIQUE INDEX "whoop_event_analysis_trace_id_key" ON "whoop_event_analysis"("trace_id");
CREATE INDEX "whoop_event_analysis_source_created_at_idx" ON "whoop_event_analysis"("source", "created_at" DESC);
CREATE INDEX "whoop_event_analysis_notification_status_created_at_idx" ON "whoop_event_analysis"("notification_status", "created_at" DESC);

CREATE UNIQUE INDEX "whoop_activity_log_trigger_key_key" ON "whoop_activity_log"("trigger_key");
CREATE INDEX "whoop_activity_log_created_at_idx" ON "whoop_activity_log"("created_at" DESC);
CREATE INDEX "whoop_activity_log_source_created_at_idx" ON "whoop_activity_log"("source", "created_at" DESC);
CREATE INDEX "whoop_activity_log_status_created_at_idx" ON "whoop_activity_log"("status", "created_at" DESC);
