ALTER TABLE prompt_runs
  ADD COLUMN IF NOT EXISTS entity_extraction_status text,
  ADD COLUMN IF NOT EXISTS entity_extractor_version text,
  ADD COLUMN IF NOT EXISTS entity_extraction_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS entity_extraction_error text,
  ADD COLUMN IF NOT EXISTS entity_extraction_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS entity_extraction_finished_at timestamptz;

CREATE TABLE IF NOT EXISTS run_answer_entities (
  id serial PRIMARY KEY,
  run_id integer NOT NULL REFERENCES prompt_runs(id) ON DELETE CASCADE,
  name text NOT NULL,
  normalized_name text NOT NULL,
  relationship text NOT NULL,
  observed_reason text NOT NULL,
  evidence_excerpt text NOT NULL,
  extractor_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS run_answer_entities_run_name_version_unique
  ON run_answer_entities (run_id, normalized_name, extractor_version);
CREATE INDEX IF NOT EXISTS run_answer_entities_run_id_idx
  ON run_answer_entities (run_id);
CREATE INDEX IF NOT EXISTS run_answer_entities_name_run_idx
  ON run_answer_entities (normalized_name, run_id);
CREATE INDEX IF NOT EXISTS prompt_runs_entity_extraction_queue_idx
  ON prompt_runs (entity_extraction_status, entity_extractor_version, created_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prompt_runs_entity_extraction_status_check'
  ) THEN
    ALTER TABLE prompt_runs ADD CONSTRAINT prompt_runs_entity_extraction_status_check
      CHECK (entity_extraction_status IS NULL OR entity_extraction_status IN
        ('pending', 'running', 'completed', 'failed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'run_answer_entities_relationship_check'
  ) THEN
    ALTER TABLE run_answer_entities ADD CONSTRAINT run_answer_entities_relationship_check
      CHECK (relationship IN ('recommended', 'compared', 'mentioned', 'other'));
  END IF;
END $$;