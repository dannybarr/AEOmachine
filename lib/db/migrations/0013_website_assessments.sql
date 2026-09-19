CREATE TABLE IF NOT EXISTS website_assessment_jobs (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running',
  phase text NOT NULL DEFAULT 'crawling',
  total_pages integer NOT NULL DEFAULT 0,
  fetched_pages integer NOT NULL DEFAULT 0,
  failed_pages integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS website_assessment_jobs_company_idx
  ON website_assessment_jobs(company_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS website_assessment_jobs_one_running_per_company
  ON website_assessment_jobs(company_id) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS website_assessment_pages (
  id serial PRIMARY KEY,
  job_id integer NOT NULL REFERENCES website_assessment_jobs(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  url text NOT NULL,
  final_url text,
  fetch_status text NOT NULL,
  http_status integer,
  title text,
  content text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS website_assessment_pages_job_url_unique
  ON website_assessment_pages(job_id, url);

CREATE TABLE IF NOT EXISTS inferred_company_profiles (
  id serial PRIMARY KEY,
  job_id integer NOT NULL REFERENCES website_assessment_jobs(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  target_audience text,
  industry text,
  objective text,
  products_services text,
  positioning text,
  geography text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS inferred_company_profiles_job_unique
  ON inferred_company_profiles(job_id);
CREATE INDEX IF NOT EXISTS inferred_company_profiles_company_status_idx
  ON inferred_company_profiles(company_id, status);

CREATE TABLE IF NOT EXISTS audience_recommendations (
  id serial PRIMARY KEY,
  job_id integer NOT NULL REFERENCES website_assessment_jobs(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  question text NOT NULL,
  normalized_question text NOT NULL,
  money_topic text NOT NULL,
  persona text NOT NULL,
  intent text NOT NULL,
  rationale text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  money_topic_id integer REFERENCES money_topics(id) ON DELETE SET NULL,
  created_prompt_id integer REFERENCES prompts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS audience_recommendations_company_status_idx
  ON audience_recommendations(company_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS audience_recommendations_company_question_unique
  ON audience_recommendations(company_id, normalized_question);

-- These guards make manual prompt/topic creation and recommendation approval
-- race-safe across server instances. Existing APIs already treat names/text
-- case-insensitively. Legacy installs can have equivalent rows, so repoint
-- every known reference before removing the deterministic (lowest-id) duplicate.
DO $$
DECLARE
  duplicate record;
BEGIN
  -- Topic dependents: prompts and strategy_items. Preserve the oldest topic,
  -- which is the canonical topic used by existing prompts.
  FOR duplicate IN
    SELECT company_id, lower(btrim(topic)) AS normalized, min(id) AS keep_id,
           array_agg(id ORDER BY id) AS duplicate_ids
    FROM money_topics
    GROUP BY company_id, lower(btrim(topic))
    HAVING count(*) > 1
  LOOP
    UPDATE prompts
    SET money_topic_id = duplicate.keep_id
    WHERE money_topic_id = ANY(duplicate.duplicate_ids)
      AND money_topic_id <> duplicate.keep_id;
    UPDATE strategy_items
    SET money_topic_id = duplicate.keep_id
    WHERE money_topic_id = ANY(duplicate.duplicate_ids)
      AND money_topic_id <> duplicate.keep_id;
    UPDATE audience_recommendations
    SET money_topic_id = duplicate.keep_id
    WHERE money_topic_id = ANY(duplicate.duplicate_ids)
      AND money_topic_id <> duplicate.keep_id;
    DELETE FROM money_topics
    WHERE id = ANY(duplicate.duplicate_ids) AND id <> duplicate.keep_id;
  END LOOP;

  -- Prompt dependents inspected here: prompt_runs, tracking_jobs,
  -- run_attempts, gap_findings, discovery_suggestions, and the denormalized
  -- prompt id fields in gap_action_provenance/gap_trends. Retain the oldest
  -- prompt and merge the useful tag/model arrays from its duplicates.
  FOR duplicate IN
    SELECT company_id, lower(btrim(text)) AS normalized, min(id) AS keep_id,
           array_agg(id ORDER BY id) AS duplicate_ids
    FROM prompts
    GROUP BY company_id, lower(btrim(text))
    HAVING count(*) > 1
  LOOP
    UPDATE prompts AS kept
    SET tags = COALESCE((
          SELECT array_agg(tag ORDER BY tag)
          FROM (
            SELECT DISTINCT unnest(candidate.tags) AS tag
            FROM prompts AS candidate
            WHERE candidate.id = ANY(duplicate.duplicate_ids)
          ) AS merged_tags
        ), ARRAY[]::text[]),
        models = COALESCE((
          SELECT array_agg(model ORDER BY model)
          FROM (
            SELECT DISTINCT unnest(candidate.models) AS model
            FROM prompts AS candidate
            WHERE candidate.id = ANY(duplicate.duplicate_ids)
          ) AS merged_models
        ), ARRAY[]::text[]),
        money_topic_id = COALESCE(
          kept.money_topic_id,
          (SELECT candidate.money_topic_id
           FROM prompts AS candidate
           WHERE candidate.id = ANY(duplicate.duplicate_ids)
             AND candidate.money_topic_id IS NOT NULL
           ORDER BY candidate.id
           LIMIT 1)
        )
    WHERE kept.id = duplicate.keep_id;

    UPDATE prompt_runs SET prompt_id = duplicate.keep_id
    WHERE prompt_id = ANY(duplicate.duplicate_ids) AND prompt_id <> duplicate.keep_id;
    UPDATE tracking_jobs SET prompt_id = duplicate.keep_id
    WHERE prompt_id = ANY(duplicate.duplicate_ids) AND prompt_id <> duplicate.keep_id;
    UPDATE run_attempts SET prompt_id = duplicate.keep_id
    WHERE prompt_id = ANY(duplicate.duplicate_ids) AND prompt_id <> duplicate.keep_id;
    UPDATE gap_findings SET prompt_id = duplicate.keep_id
    WHERE prompt_id = ANY(duplicate.duplicate_ids) AND prompt_id <> duplicate.keep_id;
    UPDATE discovery_suggestions SET created_prompt_id = duplicate.keep_id
    WHERE created_prompt_id = ANY(duplicate.duplicate_ids) AND created_prompt_id <> duplicate.keep_id;
    UPDATE audience_recommendations SET created_prompt_id = duplicate.keep_id
    WHERE created_prompt_id = ANY(duplicate.duplicate_ids) AND created_prompt_id <> duplicate.keep_id;
    UPDATE gap_action_provenance SET prompt_id = duplicate.keep_id
    WHERE prompt_id = ANY(duplicate.duplicate_ids) AND prompt_id <> duplicate.keep_id;
    UPDATE gap_trends
    SET prompt_ids = (
      SELECT jsonb_agg(prompt_id ORDER BY prompt_id)
      FROM (
        SELECT DISTINCT CASE WHEN value::integer = ANY(duplicate.duplicate_ids)
                             THEN duplicate.keep_id ELSE value::integer END AS prompt_id
        FROM jsonb_array_elements_text(prompt_ids)
      ) AS repointed_prompt_ids
    )
    WHERE prompt_ids ?| ARRAY(SELECT unnest(duplicate.duplicate_ids)::text);
    DELETE FROM prompts
    WHERE id = ANY(duplicate.duplicate_ids) AND id <> duplicate.keep_id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS prompts_company_normalized_text_unique
  ON prompts(company_id, lower(btrim(text)));
CREATE UNIQUE INDEX IF NOT EXISTS money_topics_company_normalized_topic_unique
  ON money_topics(company_id, lower(btrim(topic)));