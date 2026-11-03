# M6 database schema

Existing `headers`, `raw_logs` and `cursors` remain the core. Event identity is `(chain_id, transaction_hash, log_index, block_hash)`. `headers` stores hash, parent hash, timestamp, canonicality and finality; one canonical hash per chain/height is enforced. `raw_logs` adds transaction ordering, decoded name/JSON arguments and finality while preserving topics/data.

`reorg_journal` records ancestor, depth, orphaned hashes and outcome. `reconciliation_results` records chain/range/manifest/result/detail. `indexer_worker_state` records internal status, last success and redacted error. EVM block quantities use `numeric(78,0)`/bigint strings.

Migration: `packages/adapters/migrations/0002_m6_indexer.sql`; guarded reverse: `0002_m6_indexer.down.sql`. Apply only after backup and target approval. Isolated-schema application and atomic rollback passed; production `public` was not modified.

Migration `0003_m5_outbox_m6_fencing.sql` adds the indexer fencing counter and outbox claim owner/expiry fields. It was applied and schema-checked on the user-confirmed isolated staging database; it has not been applied to production. The current workers require this migration.
