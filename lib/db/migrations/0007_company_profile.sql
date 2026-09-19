-- Company strategic profile fields + context snapshots for provenance.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS objective text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS target_audience text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS products_services text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS positioning text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS geography text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz;

-- Immutable snapshot of the company context that informed a job's outputs,
-- so later profile edits cannot silently change a result's claimed basis.
ALTER TABLE tracking_jobs ADD COLUMN IF NOT EXISTS company_context_snapshot jsonb;
ALTER TABLE gap_research_jobs ADD COLUMN IF NOT EXISTS company_context_snapshot jsonb;
