ALTER TABLE outbox DROP COLUMN IF EXISTS claim_until;
ALTER TABLE outbox DROP COLUMN IF EXISTS claim_owner;
ALTER TABLE indexer_worker_state DROP COLUMN IF EXISTS fence_token;
