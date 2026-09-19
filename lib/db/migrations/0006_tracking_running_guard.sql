-- One running tracking job per company, DB-enforced (covers manual AND
-- scheduled triggers). Process-local guards cannot prevent concurrent
-- requests from double-claiming, so the claim must be atomic here.
CREATE UNIQUE INDEX IF NOT EXISTS tracking_jobs_one_running_per_company
  ON tracking_jobs (company_id)
  WHERE status = 'running';
