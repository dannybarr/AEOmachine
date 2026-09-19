-- Structured execution detail captured when an idea is deployed.
-- Nullable keeps existing deployed actions valid.
ALTER TABLE strategy_items ADD COLUMN IF NOT EXISTS brief jsonb;