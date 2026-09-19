CREATE INDEX IF NOT EXISTS prompt_runs_created_at_idx
  ON prompt_runs (created_at);

CREATE INDEX IF NOT EXISTS prompt_runs_model_created_at_idx
  ON prompt_runs (model, created_at);

CREATE INDEX IF NOT EXISTS prompt_runs_prompt_id_idx
  ON prompt_runs (prompt_id);

CREATE INDEX IF NOT EXISTS citations_run_id_idx
  ON citations (run_id);

CREATE INDEX IF NOT EXISTS citations_provenance_run_id_idx
  ON citations (provenance, run_id);