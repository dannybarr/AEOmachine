-- Site Lab platform linking: durable relationships between money topics,
-- tracked prompts, and deployed strategy items.
-- Idempotent: safe to re-run against a database of any state.

ALTER TABLE prompts ADD COLUMN IF NOT EXISTS money_topic_id integer;
ALTER TABLE strategy_items ADD COLUMN IF NOT EXISTS money_topic_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prompts_money_topic_id_fkey'
  ) THEN
    ALTER TABLE prompts
      ADD CONSTRAINT prompts_money_topic_id_fkey
      FOREIGN KEY (money_topic_id) REFERENCES money_topics(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'strategy_items_money_topic_id_fkey'
  ) THEN
    ALTER TABLE strategy_items
      ADD CONSTRAINT strategy_items_money_topic_id_fkey
      FOREIGN KEY (money_topic_id) REFERENCES money_topics(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS prompts_money_topic_id_idx
  ON prompts (money_topic_id);
CREATE INDEX IF NOT EXISTS strategy_items_money_topic_id_idx
  ON strategy_items (money_topic_id);
