# M0-M6 test report

Updated: 2026-11-03. Validation for the code changes in this revision used Node `v22.23.4`.

## Current-revision local checks

| Check | Result |
|---|---|
| `npm run scan:secrets` | PASS — 98 files scanned; ignored local `.env` excluded |
| `npm run check:boundaries` | PASS |
| `npm run lint` | PASS — zero lint errors |
| `npm run format:check` | PASS |
| `npm run typecheck` / build | PASS |
| `npm test` | PASS — 59/59 |
| New indexer shutdown-status fencing, RPC range fallback/backoff and fixed-head snapshot regressions | PASS |
| `git diff --check` | PASS |

Node `v22.23.4` was used for build/typecheck, lint, formatting and all 59 automated tests. No production deployment or full historical indexing was performed.

## Outcome classification

- **PASS:** requested worker lifecycle fix, SIGTERM/SIGINT bounded restart/resume, fixed-head reorg/recovery, reconciliation, cleanup, Node 22 build/typecheck/format/lint, and 59/59 tests.
- **FAIL (superseded):** the earlier ad hoc reorg check used a moving-head exact-height assertion and exited nonzero; the fixed-head bounded verifier replaced it and passed.
- **BLOCKED:** none in the authorized bounded staging checks.
- **NOT TESTED:** full historical backfill, managed Redis restart/failover, deeper/longer reorgs, abrupt process/host loss, and recurrence of the historical provider RPC error.

## Current read-only chain checks

- M3 Sepolia verification: **56/56 PASS** at finalized block `12054082`.
- Bounded M6 RPC range `12032363–12032735`: **10/10 logs decoded**, zero unknown events; head `12054095`, finalized `12054031`.
- These RPC checks were read-only.

## Current-revision isolated staging verification

- Confirmed with the user that the configured PostgreSQL and Redis endpoints are the previously authorized isolated Railway staging services. Read-only preflight verified `0001`/`0002` checksums, required tables, absent `0003` ledger/columns, no indexer/outbox DB sessions, no M6 Redis lease, and Redis PING.
- The read-only schema check passed **17/17 tables** and all **3/3 migrations**; the final preflight also confirmed the `0003` checksum and no persistent indexer/outbox session or M6 lease.
- Disposable-schema PostgreSQL verifier: migrations, CRUD, constraints, rollback, concurrent exclusive outbox claims, expired-claim recovery, stale-owner rejection, retry scheduling/dead-letter, stale indexer-fence rejection, and simulated three-block reorg recovery all **PASS**. The reorg test verified cursor rewind/replay, orphaned header/log canonicality, and the reorg journal.
- Outbox worker failure/recovery: **PASS**. A supervised Linux worker used the real staging Redis behind a local, bounded TCP proxy. The proxy briefly dropped only the worker's connections; the test message failed once, retried (attempts 1→2), published after reconnection, and was removed by its unique test key. The worker exited cleanly on SIGTERM. No shared Redis restart or interruption occurred.
- Redis verifier: PING/reconnect, TTL, unique M6 lease ownership, competing-owner rejection, stale-owner renew/release rejection, expiry takeover, and owner release all **PASS**.
- Replayed Sepolia blocks `12032363–12032735` twice in this verification: **10 logs** each run and matching logical-state hash `d832fe7e2279e3102b9f4954b36823af8e3e5de22862f2a5261029ce44673ea3`.
- Fixed-head replacement reorg verification: **PASS**. From cursor `12054421`, the verifier captured head `12054425`, applied/recovered a depth-2 synthetic fork at ancestor `12054423`, wrote exactly two journal entries, and reconciled with 0 gaps/duplicates and cursor-at-indexed-head.
- Bounded Linux worker restart/resume: **PASS** under Node `v22.23.4`. Starting cursor `12054248`; the SIGTERM run advanced to `12054415`, and the restarted SIGINT run resumed and advanced to `12054421`. Both exited 0 and wrote `STOPPED`.
- Final read-only cleanup: **PASS**. Cursor `12054425` matched the RPC block hash; worker status `STOPPED`; zero active indexer/outbox sessions; no M6 Redis lease; reconciliation `ok=true`, 0 gaps, 0 duplicates. RPC latest was `12054432`, so equality to the moving network head was not required.
- RPC investigation: a 500-block read-only `eth_getLogs` probe (`12053806–12054305`) passed. The previous transient error was recorded only by class and could not be reproduced in this bounded run. Code now treats JSON-RPC `-32602`/`InvalidParamsRpcError` on `eth_getLogs` as a potential range-limit response and bisects the request; an irreducible single-block error still propagates into the existing capped exponential retry. Structured safe diagnostics now include RPC operation, block range, code and cause type. **The precise historical provider response remains NOT REPRODUCED**; monitor diagnostics during further approved indexing.

The disposable-schema reorg drill used a simulated three-block fork; the durable staging-consumer drill used an in-memory synthetic depth-2 fork and recovered to the canonical RPC branch at a fixed RPC-head snapshot. No public-chain reorg was induced. These were bounded catch-up/restart checks, not a full historical backfill from the deployment block.

## Historical staging baseline

Prior approved staging backfill reached block `12053806`, restart resumed from cursor `12053796`, and M4–M6 migration/CRUD/constraints/concurrency/rollback and Redis TTL/lease/reconnect checks passed. The earlier baseline is not the current-revision full worker/backfill evidence.

## Not run / remaining gates

- Managed Redis restart/failover behavior; the verified fault was isolated to a local proxy connection and did not restart or interrupt the shared service.
- Full current-revision historical indexer backfill from the deployment block and deeper/longer reorg recovery beyond the completed depth-2 staging-consumer and three-block disposable simulations.
- Actual recurrence/root response for the historical transient RPC error; the likely range-limit case is handled and instrumented, but the prior provider response was not reproduced.
- SIGINT passed in the bounded staging restart/resume check; non-signal process crash/host-loss status recovery was NOT TESTED.
- Production backup/restore, migration/deployment, managed Redis recovery, and post-deployment smoke checks.
- Verification of credential rotation, production CORS origin, clean-checkout Node 22 CI, and named approvals.

No production data was modified, no production migration or deployment was performed, no worker was left running, no credentials were rotated, and no blockchain transaction was submitted.

## Proposed gated staging plan

| Priority | Check | Safe to run now? | Gate / stop condition |
|---|---|---|---|
| 1 | Supervised outbox worker with bounded connection interruption, retry, and recovery | PASS | Local TCP proxy dropped only the worker's Redis connections; attempts 1→2 completed. Managed Redis restart/failover remains gated. |
| 2 | Current-cursor catch-up, stop, and resume | PASS — bounded | From `12054248`, SIGTERM advanced to `12054415`; restart/SIGINT advanced to `12054421`. Both statuses became STOPPED; no active session/lease. Full backfill remains NOT TESTED. |
| 3 | Depth-2 synthetic fork/recovery on staging consumer | PASS — deterministic snapshot | Fixed head `12054425`; ancestor `12054423`; two journal entries; canonical cursor and reconciliation passed. No public Sepolia reorg occurred. |
| 4 | Three-block simulated fork/recovery | PASS — disposable schema | Orphaned header/log canonicality and the reorg journal were verified. Deeper/longer recovery remains gated; never induce a public Sepolia reorg. |
| 5 | Linux SIGTERM/SIGINT worker shutdown | PASS — both signals | Indexer exited 0 and set STOPPED after each signal. Outbox SIGTERM was verified previously; outbox SIGINT was NOT TESTED. |

Production remains excluded. Managed-service restart/failover, full historical backfill and deeper reorg/fault testing remain NOT TESTED and require separate explicit approval.
