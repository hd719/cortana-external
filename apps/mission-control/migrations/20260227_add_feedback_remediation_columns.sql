-- Feedback remediation tracking fields
ALTER TABLE mc_feedback_items
  ADD COLUMN IF NOT EXISTS remediation_status TEXT DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS remediation_notes TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by TEXT;

UPDATE mc_feedback_items
SET remediation_status = 'open'
WHERE remediation_status IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mc_feedback_items_remediation_status_check'
  ) THEN
    ALTER TABLE mc_feedback_items
      ADD CONSTRAINT mc_feedback_items_remediation_status_check
      CHECK (remediation_status = ANY (ARRAY['open', 'in_progress', 'resolved', 'wont_fix']));
  END IF;
END $$;
