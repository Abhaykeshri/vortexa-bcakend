# M6 test report

Updated: 2026-11-03.

## Current code revision

- Node 22 full automated suite: **59/59 PASS**; new regressions cover fenced shutdown status, InvalidParams log-range splitting with single-block failure propagation, capped retry backoff, RPC diagnostic redaction, and fixed-head source snapshots.
- Node 22 full checks: see `INDEXER_TEST_HISTORY.md`.
- Current read-only Sepolia checks: M3 **56/56 PASS** at finalized block `12054082`; bounded M6 range `12032363–12032735` returned **10/10 decoded logs**, no unknown events (latest `12054095`, finalized `12054031`).

## Current-revision isolated staging evidence

- User confirmed the configured PostgreSQL/Redis targets are the previously authorized isolated Railway staging services. Read-only preflight passed migration checksum, schema, active-session and lease checks.
- Migration `0003_m5_outbox_m6_fencing` applied successfully to staging only; the schema checker found **17/17 tables** and **3/3 migrations**.
- Temporary-schema verification passed for exclusive concurrent outbox claims, lease expiry/recovery, owner validation, retries/dead-letter, stale fencing rejection and simulated reorg recovery.
- Redis verification passed for lease ownership, competing owners, stale-owner renew/release rejection, expiry takeover and reconnect.
- Replayed `12032363–12032735` twice: 10 logs each, identical state hash `d832fe7e2279e3102b9f4954b36823af8e3e5de22862f2a5261029ce44673ea3`.
- Bounded Linux worker restart/resume: **PASS** under Node `v22.23.4`. Starting cursor `12054248`; the SIGTERM run advanced to `12054415`; the restarted SIGINT run resumed to `12054421`. Both exited 0 and set worker status to `STOPPED`.
- A supervised Linux outbox worker recovered from a bounded local TCP proxy interruption to its Redis connection: the staging test message was attempted twice, published after reconnection and removed by its unique test key. No managed Redis restart occurred.
- A simulated three-block reorg passed in a disposable schema.
- Fixed-head staging-consumer reorg drill: **PASS**. Snapshot head `12054425`, depth-2 fork ancestor `12054423`, exactly two journal entries, restored cursor at the snapshot, reconciliation 0 gaps/0 duplicates.
- Final cleanup: **PASS**. Read-only check found cursor `12054425` matching RPC, `STOPPED` worker state, zero active worker sessions, no M6 lease, and reconciliation `ok=true`.
- RPC investigation: the old `InvalidParamsRpcError` event had no operation/range/code detail and was not reproduced. A 500-block read-only `eth_getLogs` probe passed. The code now bisects `eth_getLogs` requests rejected with JSON-RPC `-32602`/`InvalidParamsRpcError`; if one-block requests still fail, the normal capped exponential retry remains in place. Safe structured diagnostics now record operation, range, RPC code and cause class. Exact historical provider cause: **NOT REPRODUCED**.

This was catch-up from the existing cursor, not a full historical backfill from the deployment block. Earlier backfill/restart evidence remains historical baseline.

## Remaining staging/production gates

- Verify managed Redis restart/failover; the completed retry drill interrupted only the worker's local proxied connection.
- Run the current-revision historical indexer backfill from the deployment block.
- Perform deeper/longer controlled reorg recovery tests in a disposable or specifically approved staging scope; bounded depth-2 staging-consumer recovery passed. Do not attempt to induce a public-chain reorg.
- SIGTERM and SIGINT passed for bounded Linux indexer runs; outbox SIGINT and abrupt host/process-loss status recovery were NOT TESTED.
- Production backup/restore, migration/deployment, managed Redis recovery, post-deploy smoke checks, credential-rotation confirmation and named approvals remain open.

Any further worker run, service interruption, or fault injection beyond the bounded checks described above requires explicit approval.

No outbox/indexer worker or lease was left active. The staging consumer was temporarily forked by the approved synthetic drill and recovered to the canonical RPC branch. No production migration, production data change, or deployment occurred.
