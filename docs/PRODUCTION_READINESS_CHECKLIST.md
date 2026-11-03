# Production readiness checklist

Date: 2026-11-03. A checked implementation item is not evidence that the corresponding live operational action occurred.

## Implemented and verified

- [x] Node 22 engine, clean-install lockfile, build/start scripts and Railway `PORT` support.
- [x] Strict startup validation; production ignores local env files.
- [x] Sepolia-only runtime and RPC chain-ID validation.
- [x] Versioned 12-contract manifest, pinned runtime hashes, ABI and wiring verifier.
- [x] Exact CORS, constant-time internal key comparison, security headers, safe errors.
- [x] Redis-backed fail-closed rate limiting.
- [x] Transactional/checksummed PostgreSQL migration and guarded rollback.
- [x] Random isolated PostgreSQL/Redis verification without shared destructive operations.
- [x] Graceful Redis reconnect policy and durable PostgreSQL outbox semantics.
- [x] Secret scan and ignored local environment files.

## Required before production release

- [ ] Provide the authoritative backend M6 specification or formally approve M6 exclusion from this release.
- [ ] Configure the real HTTPS frontend origin; owner: product/frontend operations.
- [ ] Rotate PostgreSQL, Redis, RPC, and internal API credentials; owner: infrastructure/security; do not rotate in source control.
- [ ] Take a production backup and restore it into an isolated target; record restore time and integrity checks.
- [ ] Review `verify:production:schema`, approve the exact target, and apply the migration.
- [ ] Run a managed Redis restart/reconnect and worker retry/dead-letter drill without flushing shared data.
- [ ] Deploy to Railway using private PostgreSQL/Redis networking.
- [ ] Run public liveness plus server-authenticated readiness and endpoint smoke checks after deployment.
- [ ] Obtain named contract ownership, security, operations, data migration, and release approvals.
- [ ] Record rollback owner, rollback trigger, prior deploy artifact, database recovery point, and communication plan.

## Prohibited without explicit approval

Production migration/rollback, credential rotation, shared Redis restart/flush, deployment, contract transaction, signer activation, and production data deletion. Current release verdict: **not production-approved**.
