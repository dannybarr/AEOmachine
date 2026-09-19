-- Durable cooldown state for the live provider contract audit.
-- A single row records when an audit last started; the atomic conditional
-- upsert in the API server enforces a minimum interval between audits even
-- across process restarts (cost-abuse control for paid provider calls).
CREATE TABLE IF NOT EXISTS contract_audit_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  last_started_at timestamptz NOT NULL
);
