-- Bridge OpenClaw sub-agent lifecycle into mission-control runs
ALTER TABLE "Run"
  ADD COLUMN IF NOT EXISTS "openclaw_run_id" TEXT,
  ADD COLUMN IF NOT EXISTS "external_status" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Run_openclaw_run_id_key" ON "Run"("openclaw_run_id");
