-- Immutable per-job snapshot of fetched page evidence on gap_evidence.
-- gap_source_pages is a mutable freshness cache; without these columns a
-- later refetch could rewrite an earlier finding's verification status.
ALTER TABLE gap_evidence ADD COLUMN IF NOT EXISTS page_fetch_status text;
ALTER TABLE gap_evidence ADD COLUMN IF NOT EXISTS page_http_status integer;
ALTER TABLE gap_evidence ADD COLUMN IF NOT EXISTS page_title text;
ALTER TABLE gap_evidence ADD COLUMN IF NOT EXISTS page_snippet text;
ALTER TABLE gap_evidence ADD COLUMN IF NOT EXISTS page_signals jsonb;
ALTER TABLE gap_evidence ADD COLUMN IF NOT EXISTS page_fetched_at timestamptz;

-- Backfill existing evidence rows from the current cache so historical
-- reports keep their page context (best available approximation).
UPDATE gap_evidence e
SET page_fetch_status = p.fetch_status,
    page_http_status = p.http_status,
    page_title = p.title,
    page_snippet = p.snippet,
    page_signals = p.page_signals,
    page_fetched_at = p.fetched_at
FROM gap_source_pages p
WHERE e.source_page_id = p.id
  AND e.page_fetch_status IS NULL;
