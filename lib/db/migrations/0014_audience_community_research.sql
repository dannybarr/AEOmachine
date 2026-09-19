ALTER TABLE audience_recommendations
  ADD COLUMN IF NOT EXISTS research_evidence jsonb NOT NULL DEFAULT '[]'::jsonb;