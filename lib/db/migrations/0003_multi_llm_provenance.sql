-- Multi-LLM landscape: attempt provenance, citation verification metadata,
-- per-prompt tracking jobs, and immutable model snapshots. Idempotent.
-- Historical rows keep NULL in the new columns and are surfaced as
-- "legacy / provenance unknown" — never rewritten.

ALTER TABLE prompt_runs ADD COLUMN IF NOT EXISTS search_status text;
ALTER TABLE prompt_runs ADD COLUMN IF NOT EXISTS citation_eligible boolean;
ALTER TABLE prompt_runs ADD COLUMN IF NOT EXISTS duration_ms integer;

ALTER TABLE citations ADD COLUMN IF NOT EXISTS provenance text;
ALTER TABLE citations ADD COLUMN IF NOT EXISTS metadata jsonb;

ALTER TABLE tracking_jobs ADD COLUMN IF NOT EXISTS prompt_id integer REFERENCES prompts(id) ON DELETE CASCADE;
ALTER TABLE tracking_jobs ADD COLUMN IF NOT EXISTS models_snapshot jsonb;

-- Every simulation attempt (success or failure) with timing and outcome, so
-- failed attempts are auditable without polluting prompt_runs (which holds
-- only real answers and therefore keeps metric denominators honest).
CREATE TABLE IF NOT EXISTS run_attempts (
  id serial PRIMARY KEY,
  job_id integer REFERENCES tracking_jobs(id) ON DELETE SET NULL,
  prompt_id integer NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  model text NOT NULL,
  outcome text NOT NULL,
  error text,
  duration_ms integer,
  run_id integer REFERENCES prompt_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS run_attempts_prompt_idx ON run_attempts (prompt_id, created_at);
CREATE INDEX IF NOT EXISTS run_attempts_job_idx ON run_attempts (job_id);
