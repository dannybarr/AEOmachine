-- Citation quality audit: structured per-run extraction diagnostics.
-- search_status gains granular values (provider_cited, search_no_citations,
-- extraction_failed) alongside legacy provider_search; historical rows are
-- never rewritten. Idempotent.

ALTER TABLE prompt_runs ADD COLUMN IF NOT EXISTS citation_diagnostics jsonb;
