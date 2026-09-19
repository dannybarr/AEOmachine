-- Evolving client case studies: per-company authored context, immutable
-- dated story revisions with evidence snapshots, and durable background
-- narrative-refresh jobs.

CREATE TABLE IF NOT EXISTS case_studies (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  starting_position text,
  strategic_focus text,
  context_notes text,
  context_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS case_studies_company_unique
  ON case_studies (company_id);

CREATE TABLE IF NOT EXISTS case_study_revisions (
  id serial PRIMARY KEY,
  case_study_id integer NOT NULL REFERENCES case_studies(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  revision_number integer NOT NULL,
  kind text NOT NULL,
  narrative text NOT NULL,
  edited_narrative text,
  approved_at timestamptz,
  evidence_snapshot jsonb NOT NULL,
  period_start text,
  period_end text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS case_study_revisions_number_unique
  ON case_study_revisions (case_study_id, revision_number);

CREATE TABLE IF NOT EXISTS case_study_jobs (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running',
  stage text NOT NULL DEFAULT 'collecting_evidence',
  error text,
  revision_id integer REFERENCES case_study_revisions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS case_study_jobs_one_running_per_company
  ON case_study_jobs (company_id)
  WHERE status = 'running';
