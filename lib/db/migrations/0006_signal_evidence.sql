-- Optional grounded evidence signal on catalog signals ("actions").
-- Shape mirrors the ActionEvidence API schema; NULL means no precedent on
-- file (original ideas stay evidence-free rather than getting invented
-- justification).
ALTER TABLE signals ADD COLUMN IF NOT EXISTS evidence jsonb;
