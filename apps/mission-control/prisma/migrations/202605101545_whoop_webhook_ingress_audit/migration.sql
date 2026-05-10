CREATE TABLE "whoop_webhook_ingress_audit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "event_type" TEXT,
    "trace_id" TEXT,
    "resource_id" TEXT,
    "body_bytes" INTEGER NOT NULL DEFAULT 0,
    "signature_present" BOOLEAN NOT NULL DEFAULT false,
    "timestamp_present" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whoop_webhook_ingress_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "whoop_webhook_ingress_audit_received_at_idx" ON "whoop_webhook_ingress_audit"("received_at" DESC);
CREATE INDEX "whoop_webhook_ingress_audit_status_received_at_idx" ON "whoop_webhook_ingress_audit"("status", "received_at" DESC);
CREATE INDEX "whoop_webhook_ingress_audit_trace_id_idx" ON "whoop_webhook_ingress_audit"("trace_id");
