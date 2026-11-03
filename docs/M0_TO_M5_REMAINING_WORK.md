# M0-M5 remaining work and blockers

Status update: 2026-11-03. M6 implementation now exists in this repository; historical M0-M5 scope notes below are updated where that changes the release gates.

## Approval and ownership

- Assign and record the backend owner, contract lead, security reviewer, operator and release authority; approve the M0 scope/threat model/role matrix.
- The backend Git repository, remote, and commit history exist. Review the uncommitted work, then establish a clean-checkout CI run and reviewed release commit/PR evidence before release.
- Obtain contract-lead/release-authority signature for `sepolia-v1-2026-11-02`; technical ABI and normalized deployed-bytecode equivalence is already 12/12 PASS.

## M1-M3

- Re-run `npm ci && npm run check` from a clean Git checkout. Local checks pass, but a clean-checkout run was not performed for this status update.

## M4

- Before an approved migration: rotate exposed credentials, take/verify a Railway backup, review the schema, and run `npm run migrate` against staging.
- Rehearse PITR/restore in an operator-approved staging database and record RPO/RTO. Repeat migration, constraints, concurrent idempotency and rollback already pass in an isolated Railway schema.

## M5

- Migration `0003_m5_outbox_m6_fencing` is applied to confirmed isolated staging. Disposable-schema checks passed competing claims, expiry/recovery, owner checks, retry scheduling and dead-letter behavior. Still run the supervised outbox worker through managed Redis failure/recovery to verify notification retry end-to-end.
- Run the new `npm run outbox:start` process in staging, then perform a managed Redis restart/reconnect and prove notifications retry from the durable outbox.
- M6 is implemented, but verify cache invalidation on reorg before introducing any cache-backed indexed projections.

## M6 code revision

- The worker now has a unique Redis lease owner and monotonic PostgreSQL fencing token; the new token guard requires migration `0003`.
- Replay verifies the RPC chain before connecting to PostgreSQL; log-range splitting retries only recognized provider limits.
- Current-revision staging passed lease expiry/takeover, stale fencing rejection, bounded replay twice, reconciliation with 0 gaps/duplicates, and simulated reorg recovery in a disposable schema. Historical backfill/restart evidence remains baseline only.
- Run full current-revision worker backfill/restart, controlled live-chain reorg drills and Linux graceful-shutdown checks in approved staging.

## Beyond M5

M7-M19 remain outside this M0-M6 scope. SIWE/API auth is M8, unsigned wallet intents are M10, keeper shadow mode is M12, and any privileged signer/broadcast is M13 and remains disabled pending explicit approval.

The M0-M6 code foundation is usable for continued development, but release readiness is blocked by approvals, clean-checkout/review evidence, staging migration/restore evidence, independent security review and resilience drills. No production deployment or shared-schema mutation was performed.
