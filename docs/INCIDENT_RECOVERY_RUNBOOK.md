# Redis, indexer, and outbox recovery runbook

All shared-service restarts, fault injection, replay, and reconciliation commands require an approved target and operator. Never flush shared Redis.

## Redis interruption

Expected behavior:

- Public rate-limited routes fail closed with `503 SECURITY_DEPENDENCY_UNAVAILABLE`.
- Read caches may miss without changing PostgreSQL state.
- Indexer lease renewal eventually fails and the worker exits degraded.
- PostgreSQL fencing prevents an old indexer from writing after a replacement acquires a newer fence.
- Outbox publication retries from durable PostgreSQL rows.

Recovery:

1. Confirm the managed Redis incident and preserve API/worker logs.
2. Restore Redis connectivity without flushing keys.
3. Start exactly one indexer and one outbox worker.
4. Verify a fresh lease owner, newer indexer fence, advancing cursor, decreasing outbox backlog, and no unexpected dead letters.
5. Run authenticated readiness and endpoint smoke checks.

## Indexer backfill or restart

1. Verify the RPC chain ID, pinned contract hashes, database schema, and absence of another active worker.
2. Record the starting cursor and finalized head.
3. Start one worker with its unique `INDEXER_WORKER_ID` and monitor `indexer_batch`, retry, lease, and reorg events.
4. For a bounded operator-approved replay, use:

   ```text
   npm run indexer:replay -- --from <block> --to <block>
   npm run indexer:reconcile
   npm run verify:live:projections
   ```

5. A `REORG_RECOVERY_LIMIT_EXCEEDED`, fence loss, canonical hash mismatch, or projection parity failure is a stop condition.

Synthetic reorg verification is staging-only. It must run against an isolated, disposable staging database and Redis endpoint through `npm run verify:staging:indexer-reorg`; never attempt to induce a public-chain reorg.

## Outbox recovery

1. Record pending, claimed, retrying, and dead-letter counts using read-only SQL.
2. Confirm no duplicate worker identity or stale claim owner is active.
3. Start one outbox worker and observe `outbox_batch` and `outbox_batch_failed` events.
4. Confirm expired claims are reclaimed, successful rows receive `processed_at`, failed rows use bounded backoff, and exhausted rows receive `dead_lettered_at`.
5. Requeueing a dead letter changes durable production data and requires explicit product/operations approval plus an idempotency review.

## Evidence to retain

Incident timeline, affected revision, service deployment IDs, cursor/fence movement, outbox counts, recovery commands, smoke results, data reconciliation, and named incident closure approval.

