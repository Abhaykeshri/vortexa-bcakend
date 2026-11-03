# M6 reorg recovery

Before advancing, the worker compares the durable cursor hash with the provider block at that height. On mismatch it walks backward, bounded by `INDEXER_MAX_REORG_DEPTH`, until a stored canonical header matches the provider.

Recovery transaction marks later headers/logs noncanonical, resets their finality to observed, records all orphaned hashes in `reorg_journal`, and rewinds the cursor to the common ancestor. The next batch replays the replacement branch. Rows are retained for audit; financial history is never silently deleted.

If no common ancestor is found within the approved limit, indexing stops with `REORG_RECOVERY_LIMIT_EXCEEDED`. Operators must compare providers, approve a deeper range, reconcile and replay. Tests cover shallow rollback and deep fail-closed behavior; live reorg injection remains a controlled staging/chaos gate.
