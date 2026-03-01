-- Add quarantine timestamp for task board reconciliation safety

ALTER TABLE IF EXISTS "cortana_tasks"
  ADD COLUMN IF NOT EXISTS "quarantined_at" TIMESTAMP(3);

ALTER TABLE IF EXISTS "cortana_epics"
  ADD COLUMN IF NOT EXISTS "quarantined_at" TIMESTAMP(3);
