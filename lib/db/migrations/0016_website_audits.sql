CREATE TABLE IF NOT EXISTS website_audit_findings (
  id serial PRIMARY KEY,
  job_id integer NOT NULL REFERENCES website_assessment_jobs(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  category_scores jsonb NOT NULL,
  counts jsonb NOT NULL,
  pages_scanned integer NOT NULL,
  methodology jsonb NOT NULL,
  findings jsonb NOT NULL,
  quick_wins jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE website_assessment_jobs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'automatic';
ALTER TABLE website_assessment_jobs
  DROP CONSTRAINT IF EXISTS website_assessment_jobs_source_check;
ALTER TABLE website_assessment_jobs
  ADD CONSTRAINT website_assessment_jobs_source_check
  CHECK (source IN ('automatic', 'manual_rerun'));
CREATE UNIQUE INDEX IF NOT EXISTS website_audit_findings_job_unique
  ON website_audit_findings(job_id);
CREATE INDEX IF NOT EXISTS website_audit_findings_company_generated_idx
  ON website_audit_findings(company_id, generated_at);

CREATE TABLE IF NOT EXISTS website_audit_quick_win_promotions (
  id serial PRIMARY KEY,
  audit_id integer NOT NULL REFERENCES website_audit_findings(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  quick_win_code text NOT NULL,
  strategy_item_id integer NOT NULL REFERENCES strategy_items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS website_audit_quick_win_promotion_unique
  ON website_audit_quick_win_promotions(audit_id, quick_win_code);