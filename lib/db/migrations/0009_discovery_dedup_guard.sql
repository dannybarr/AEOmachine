-- Enforce discovery suggestion deduplication at the database level:
-- at most one *pending* suggestion per company for the same question text.
CREATE UNIQUE INDEX IF NOT EXISTS discovery_suggestions_pending_unique
  ON discovery_suggestions (company_id, lower(text))
  WHERE status = 'pending';
