-- Methodology P0: persist the visibility ladder on each successful run.
-- NULL = legacy runs recorded before the rung existed. Idempotent.

ALTER TABLE prompt_runs ADD COLUMN IF NOT EXISTS visibility_rung text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prompt_runs_visibility_rung_check'
  ) THEN
    ALTER TABLE prompt_runs ADD CONSTRAINT prompt_runs_visibility_rung_check
      CHECK (visibility_rung IS NULL OR visibility_rung IN
        ('recommended', 'cited', 'mentioned', 'absent'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS prompt_runs_visibility_rung_idx
  ON prompt_runs (visibility_rung);
