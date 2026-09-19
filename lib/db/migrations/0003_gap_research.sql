-- Evidence-backed Gap Analysis research records. Idempotent.

CREATE TABLE IF NOT EXISTS gap_research_jobs (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running',
  phase text NOT NULL DEFAULT 'collecting',
  window_days integer NOT NULL DEFAULT 30,
  analysis_version integer NOT NULL DEFAULT 1,
  eligible_run_count integer NOT NULL DEFAULT 0,
  ineligible_run_count integer NOT NULL DEFAULT 0,
  gap_prompt_count integer NOT NULL DEFAULT 0,
  total_sources integer NOT NULL DEFAULT 0,
  fetched_sources integer NOT NULL DEFAULT 0,
  failed_sources integer NOT NULL DEFAULT 0,
  cached_sources integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS gap_source_pages (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  canonical_url text NOT NULL,
  domain text NOT NULL,
  fetch_status text NOT NULL,
  http_status integer,
  final_url text,
  title text,
  snippet text,
  page_signals jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gap_source_pages_company_url_unique UNIQUE (company_id, canonical_url)
);

CREATE TABLE IF NOT EXISTS gap_findings (
  id serial PRIMARY KEY,
  job_id integer NOT NULL REFERENCES gap_research_jobs(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  prompt_id integer NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  prompt_text text NOT NULL,
  topic text NOT NULL,
  gap_type text NOT NULL,
  run_count integer NOT NULL DEFAULT 0,
  eligible_run_count integer NOT NULL DEFAULT 0,
  mention_count integer NOT NULL DEFAULT 0,
  citation_count integer NOT NULL DEFAULT 0,
  model_coverage jsonb NOT NULL,
  competitors jsonb NOT NULL,
  recommendation jsonb NOT NULL,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gap_evidence (
  id serial PRIMARY KEY,
  finding_id integer NOT NULL REFERENCES gap_findings(id) ON DELETE CASCADE,
  source_page_id integer REFERENCES gap_source_pages(id) ON DELETE SET NULL,
  canonical_url text NOT NULL,
  domain text NOT NULL,
  channel text NOT NULL,
  is_competitor boolean NOT NULL DEFAULT false,
  citation_count integer NOT NULL DEFAULT 0,
  run_count integer NOT NULL DEFAULT 0,
  avg_position real,
  best_position integer,
  models jsonb NOT NULL,
  run_ids jsonb NOT NULL,
  answer_context text,
  last_seen_at timestamptz
);

CREATE TABLE IF NOT EXISTS gap_trends (
  id serial PRIMARY KEY,
  job_id integer NOT NULL REFERENCES gap_research_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  observation text NOT NULL,
  hypothesis text,
  contradictory_evidence text,
  confidence text NOT NULL,
  sample_size integer NOT NULL DEFAULT 0,
  prompt_ids jsonb NOT NULL,
  domain text,
  channel text,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gap_action_provenance (
  id serial PRIMARY KEY,
  strategy_item_id integer NOT NULL REFERENCES strategy_items(id) ON DELETE CASCADE,
  finding_id integer NOT NULL REFERENCES gap_findings(id) ON DELETE CASCADE,
  job_id integer NOT NULL REFERENCES gap_research_jobs(id) ON DELETE CASCADE,
  prompt_id integer NOT NULL,
  evidence_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gap_action_provenance_finding_unique
  ON gap_action_provenance (finding_id);

CREATE INDEX IF NOT EXISTS gap_findings_job_idx ON gap_findings (job_id);
CREATE INDEX IF NOT EXISTS gap_evidence_finding_idx ON gap_evidence (finding_id);
CREATE INDEX IF NOT EXISTS gap_trends_job_idx ON gap_trends (job_id);
CREATE INDEX IF NOT EXISTS gap_research_jobs_company_idx ON gap_research_jobs (company_id);
