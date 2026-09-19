-- Atomically enforce one active research job per company at the database
-- level (the in-memory guard is process-local and races across instances).
CREATE UNIQUE INDEX IF NOT EXISTS gap_research_jobs_one_running_per_company
  ON gap_research_jobs (company_id)
  WHERE status = 'running';
