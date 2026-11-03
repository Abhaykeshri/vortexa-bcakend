DROP TABLE IF EXISTS indexer_worker_state,reconciliation_results,reorg_journal;
DROP INDEX IF EXISTS raw_logs_canonical_order_idx,headers_one_canonical_height_uq;
ALTER TABLE raw_logs DROP COLUMN IF EXISTS finality,DROP COLUMN IF EXISTS event_args,DROP COLUMN IF EXISTS event_name,DROP COLUMN IF EXISTS transaction_index;
ALTER TABLE headers DROP COLUMN IF EXISTS block_timestamp;
