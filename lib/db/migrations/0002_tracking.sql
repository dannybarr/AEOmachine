-- Bulk tracking runs + daily auto-tracking flag. Idempotent.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS auto_track_daily boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS tracking_jobs (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  run_date text NOT NULL,
  trigger text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  total_simulations integer NOT NULL DEFAULT 0,
  succeeded integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- At most one scheduled batch per company per UTC day, enforced at the DB
-- level so concurrent scheduler instances cannot double-run.
CREATE UNIQUE INDEX IF NOT EXISTS tracking_jobs_scheduled_once_per_day
  ON tracking_jobs (company_id, run_date)
  WHERE trigger = 'scheduled';
