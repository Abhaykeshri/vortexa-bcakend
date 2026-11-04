# M6 indexer architecture

`apps/indexer` is separate from the public API. It loads typed configuration, acquires a chain-scoped Redis lease, verifies Sepolia `11155111`, reads safe/finalized heads, resumes the PostgreSQL cursor, checks the cursor hash, processes a bounded range, decodes actual local ABIs and atomically commits canonical headers/logs/cursor.

Data flow: RPC -> `ViemIndexerSource` -> `BlockchainIndexerService` -> `PostgresIndexerStore`. Redis coordinates one worker but never stores the checkpoint. Provider range errors recursively split ranges; malformed blocks/logs fail closed. Structured logs contain chain/range/count/error type, never RPC/database secrets.

Configuration: `ACTIVE_CHAIN_ID` selects the currently supported Sepolia chain; the indexer shares it rather than accepting a duplicate chain ID. `INDEXER_ENABLED`, `INDEXER_START_BLOCK`, `INDEXER_BATCH_SIZE`, bounded `INDEXER_HEADER_CONCURRENCY`, `INDEXER_POLL_INTERVAL_MS`, explicit `INDEXER_CONFIRMATIONS`, explicit `INDEXER_MAX_REORG_DEPTH`, and unique `INDEXER_WORKER_ID` control the worker. Enabling requires PostgreSQL and Redis. Only Sepolia is accepted.

The worker is started with `npm run indexer:start` after build/migration and stopped with SIGINT/SIGTERM. Loss of lease prevents unsafe concurrent indexing.
