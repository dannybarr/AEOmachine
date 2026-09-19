-- Persist discovery suggestions and company-scope Site Lab records.

CREATE TABLE IF NOT EXISTS discovery_suggestions (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  text text NOT NULL,
  topic text NOT NULL,
  rationale text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'added', 'dismissed')),
  created_prompt_id integer REFERENCES prompts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discovery_suggestions_company_status_idx
  ON discovery_suggestions (company_id, status);

-- Site tests become company-scoped. Backfill existing rows to the earliest
-- company, then enforce NOT NULL only when every row has an owner.
ALTER TABLE site_tests ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id) ON DELETE CASCADE;

UPDATE site_tests
SET company_id = (SELECT id FROM companies ORDER BY id ASC LIMIT 1)
WHERE company_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM site_tests WHERE company_id IS NULL) THEN
    -- Rows exist but no company could own them. Fail loudly rather than
    -- leaving orphaned sites invisible to every company-scoped list.
    RAISE EXCEPTION 'site_tests has rows but no company exists to own them. Create a company, assign site_tests.company_id, then re-run migrations.';
  END IF;
  ALTER TABLE site_tests ALTER COLUMN company_id SET NOT NULL;
END $$;

CREATE INDEX IF NOT EXISTS site_tests_company_idx ON site_tests (company_id);
