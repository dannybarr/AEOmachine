ALTER TABLE website_audit_findings
  ADD COLUMN IF NOT EXISTS audit_version text NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS category_narratives jsonb NOT NULL DEFAULT '{}'::jsonb;