ALTER TABLE mc_council_sessions
  ADD COLUMN IF NOT EXISTS model_policy JSONB NOT NULL DEFAULT '{"voter":"gpt-4o-mini","synthesizer":"claude-3-5-sonnet"}'::jsonb;
