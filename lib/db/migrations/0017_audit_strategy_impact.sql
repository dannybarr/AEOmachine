ALTER TABLE strategy_items
  ADD COLUMN IF NOT EXISTS live_at timestamptz;

ALTER TABLE website_audit_quick_win_promotions
  ADD COLUMN IF NOT EXISTS baseline jsonb;

ALTER TABLE website_audit_quick_win_promotions
  ALTER COLUMN baseline DROP DEFAULT,
  ALTER COLUMN baseline DROP NOT NULL;

UPDATE website_audit_quick_win_promotions promotion
SET baseline = jsonb_build_object(
  'windowStart', audit.generated_at - interval '14 days',
  'windowEnd', audit.generated_at,
  'eligibleRuns', (
    SELECT count(*)::int
    FROM prompt_runs run
    INNER JOIN prompts prompt ON prompt.id = run.prompt_id
    WHERE prompt.company_id = promotion.company_id
      AND run.created_at >= audit.generated_at - interval '14 days'
      AND run.created_at < audit.generated_at
      AND run.citation_eligible IS TRUE
  ),
  'citedRuns', (
    SELECT count(*)::int
    FROM prompt_runs run
    INNER JOIN prompts prompt ON prompt.id = run.prompt_id
    WHERE prompt.company_id = promotion.company_id
      AND run.created_at >= audit.generated_at - interval '14 days'
      AND run.created_at < audit.generated_at
      AND run.citation_eligible IS TRUE
      AND EXISTS (
        SELECT 1
        FROM citations citation
        WHERE citation.run_id = run.id
          AND citation.domain_type = 'you'
          AND citation.provenance = 'provider'
      )
  ),
  'totalRuns', (
    SELECT count(*)::int
    FROM prompt_runs run
    INNER JOIN prompts prompt ON prompt.id = run.prompt_id
    WHERE prompt.company_id = promotion.company_id
      AND run.created_at >= audit.generated_at - interval '14 days'
      AND run.created_at < audit.generated_at
  ),
  'visibleRuns', (
    SELECT count(*)::int
    FROM prompt_runs run
    INNER JOIN prompts prompt ON prompt.id = run.prompt_id
    WHERE prompt.company_id = promotion.company_id
      AND run.created_at >= audit.generated_at - interval '14 days'
      AND run.created_at < audit.generated_at
      AND run.brand_mentioned IS TRUE
  ),
  'models', (
    SELECT coalesce(jsonb_agg(models.model ORDER BY models.model), '[]'::jsonb)
    FROM (
      SELECT DISTINCT run.model
      FROM prompt_runs run
      INNER JOIN prompts prompt ON prompt.id = run.prompt_id
      WHERE prompt.company_id = promotion.company_id
        AND run.created_at >= audit.generated_at - interval '14 days'
        AND run.created_at < audit.generated_at
    ) models
  )
)
FROM website_audit_findings audit
WHERE audit.id = promotion.audit_id
  AND (
    promotion.baseline IS NULL
    OR promotion.baseline->>'windowStart' = promotion.baseline->>'windowEnd'
  );

ALTER TABLE website_audit_quick_win_promotions
  ALTER COLUMN baseline SET NOT NULL;