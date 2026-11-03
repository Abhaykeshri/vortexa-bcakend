ALTER TABLE outbox ADD COLUMN IF NOT EXISTS claim_owner text;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS claim_until timestamptz;

ALTER TABLE indexer_worker_state
  ADD COLUMN IF NOT EXISTS fence_token bigint NOT NULL DEFAULT 0;
