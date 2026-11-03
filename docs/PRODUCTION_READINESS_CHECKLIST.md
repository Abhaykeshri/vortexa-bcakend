# Production readiness checklist

Updated: 2026-11-03. A checked implementation item is not evidence that the corresponding live operational action occurred.

## Implemented and verified

- [x] Node 22 engine, clean-install lockfile, build/start scripts and Railway `PORT` support.
- [x] Strict startup validation; production ignores local env files.
- [x] Sepolia-only runtime and RPC chain-ID validation.
- [x] Versioned 12-contract manifest, pinned runtime hashes, ABI and wiring verifier.
- [x] Exact CORS, constant-time internal key comparison, security headers, safe errors.
- [x] Redis-backed fail-closed rate limiting.
- [x] Transactional/checksummed PostgreSQL migrations and guarded rollback.
- [x] Random isolated PostgreSQL/Redis verification without shared destructive operations.
- [x] Durable PostgreSQL outbox claim leases, owner-checked completion/retry, and independent worker implementation.
- [x] Unique Redis indexer lease owners and PostgreSQL fencing checks on indexer writes.
- [x] Replay chain validation and RPC range-limit-specific adaptive splitting.
- [x] Proxy rate-limit identity uses the rightmost validated forwarded peer when trusted-proxy mode is configured.
- [x] Secret scan and ignored local environment files.

## Required before production release

- [x] Apply migration `0003_m5_outbox_m6_fencing` to user-confirmed isolated staging after checksum/schema/session/lease preflight; verify outbox exclusive claims/retry/dead-letter, indexer fencing, Redis lease expiry/takeover, bounded replay and reconciliation.
- [x] Supervised outbox retry/recovery passed through a bounded local TCP proxy interruption; managed Redis restart/failover remains unverified.
- [x] Bounded Linux indexer SIGTERM/SIGINT restart/resume passed: cursor `12054248`→`12054415`→`12054421`; both processes exited 0 and persisted STOPPED. No active worker session or Redis lease remained. Full historical backfill is still not tested.
- [x] Fixed-head depth-2 staging reorg passed at snapshot `12054425` (ancestor `12054423`); fork and recovery journaled, cursor restored to the snapshot, reconciliation had 0 gaps/duplicates. The verifier no longer compares against the moving network head.
- [x] Fenced worker shutdown status now writes STOPPED on graceful signals and DEGRADED on fatal exit; stale workers cannot overwrite a newer fence. Local regression and staging signal tests passed.
- [x] `eth_getLogs` JSON-RPC `-32602`/InvalidParams failures now use bounded adaptive range splitting; irreducible failures preserve capped exponential retry/backoff. Regression tests passed. Exact historical provider failure was **NOT REPRODUCED**; safe operation/range/code telemetry was added.
- [ ] Complete full current-revision M6 backfill and deeper/longer controlled staging reorg recovery (never induce a public-chain reorg), or formally approve M6 exclusion from this release.
- [ ] Confirm the trusted ingress appends/overwrites the observed client address as the rightmost `X-Forwarded-For` value and the API is not directly reachable before enabling `TRUST_PROXY`.
- [ ] Configure the real HTTPS frontend origin; owner: product/frontend operations.
- [ ] Rotate PostgreSQL, Redis, RPC, and internal API credentials; owner: infrastructure/security; do not rotate in source control.
- [ ] Take a production backup and restore it into an isolated target; record restore time and integrity checks.
- [ ] Review `verify:production:schema`, approve the exact target, and apply all pending migrations.
- [ ] Run a managed Redis restart/reconnect and worker retry/dead-letter drill without flushing shared data; the completed retry drill interrupted only a local proxy connection.
- [ ] Verify abrupt host/process-loss status recovery and outbox SIGINT; rerun clean-checkout CI with Node 22.
- [ ] Deploy to Railway using private PostgreSQL/Redis networking.
- [ ] Run public liveness plus server-authenticated readiness and endpoint smoke checks after deployment.
- [ ] Obtain named contract ownership, security, operations, data migration, and release approvals.
- [ ] Record rollback owner, rollback trigger, prior deploy artifact, database recovery point, and communication plan.

## Prohibited without explicit approval

Production migration/rollback, credential rotation, shared Redis restart/flush, deployment, contract transaction, signer activation, production data deletion, persistent staging workers/restarts, and staging fault injection. Current release verdict: **not production-approved**.
