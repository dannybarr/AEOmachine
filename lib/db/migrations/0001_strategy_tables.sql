-- Strategy Ideas library + 5-step playbook tables.
-- Idempotent: safe to re-run against a database of any state.

CREATE TABLE IF NOT EXISTS strategy_ideas (
  id serial PRIMARY KEY,
  title text NOT NULL,
  category text NOT NULL,
  play_type text NOT NULL,
  description text NOT NULL,
  rationale text NOT NULL,
  priority text NOT NULL DEFAULT 'P1',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Guarantees idempotent, concurrency-safe seeding of the ideas catalog
-- (inserts use ON CONFLICT (title) DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS strategy_ideas_title_unique
  ON strategy_ideas (title);

CREATE TABLE IF NOT EXISTS strategy_items (
  id serial PRIMARY KEY,
  idea_id integer NOT NULL,
  company_id integer NOT NULL,
  money_topic text,
  status text NOT NULL DEFAULT 'not_started',
  notes text,
  target_date text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS money_topics (
  id serial PRIMARY KEY,
  company_id integer NOT NULL,
  topic text NOT NULL,
  question text,
  source text,
  priority text NOT NULL DEFAULT 'medium',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS weekly_measurements (
  id serial PRIMARY KEY,
  company_id integer NOT NULL,
  week_of text NOT NULL,
  total_prompts integer NOT NULL DEFAULT 0,
  brand_mentions integer NOT NULL DEFAULT 0,
  competitor_mentions_avg real,
  share_of_voice_pct real,
  consensus_answer boolean,
  top_page_type text,
  key_takeaway text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Foreign keys, added only when missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'strategy_items_idea_id_strategy_ideas_id_fk'
  ) THEN
    ALTER TABLE strategy_items
      ADD CONSTRAINT strategy_items_idea_id_strategy_ideas_id_fk
      FOREIGN KEY (idea_id) REFERENCES strategy_ideas(id) ON DELETE CASCADE;
  END IF;

  -- The companies FKs are only added once the companies table exists
  -- (on a clean database drizzle push creates it; re-running this
  -- migration afterwards converges the constraints).
  IF to_regclass('companies') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'strategy_items_company_id_companies_id_fk'
    ) THEN
      ALTER TABLE strategy_items
        ADD CONSTRAINT strategy_items_company_id_companies_id_fk
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'money_topics_company_id_companies_id_fk'
    ) THEN
      ALTER TABLE money_topics
        ADD CONSTRAINT money_topics_company_id_companies_id_fk
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'weekly_measurements_company_id_companies_id_fk'
    ) THEN
      ALTER TABLE weekly_measurements
        ADD CONSTRAINT weekly_measurements_company_id_companies_id_fk
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;
