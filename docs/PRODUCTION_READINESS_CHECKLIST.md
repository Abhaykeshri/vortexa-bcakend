# Production release checklist

Updated: 2026-11-04. A checked implementation item is not proof that an approval-controlled live action occurred.

## Implemented in the repository

- [x] Express MVC with hexagonal domain/application/adapter boundaries
- [x] Strict Node.js 22 configuration validation and process-specific secret scope
- [x] Sepolia chain validation, 15-contract manifest, pinned runtime hashes, and ABI/wiring checks
- [x] Exact CORS, bearer protection, Helmet, safe errors, payload limits, and Redis fail-closed rate limiting
- [x] Structured request/worker logging, request IDs, health endpoints, and bounded graceful shutdown
- [x] Transactional checksummed PostgreSQL migrations with advisory locking and guarded down migration
- [x] Durable outbox claims/retry/dead-letter behavior and indexer leases/fencing/reorg recovery
- [x] Current Railway TypeScript IaC for separate API, indexer, and outbox services with no automatic migration hook
- [x] Read-only production smoke, configuration inspection, static release verification, and timelock inspection tools
- [x] Backup/restore, incident recovery, observability, rollback, deployment, and timelock runbooks
- [x] Clean-install CI, production dependency audit, secret scan, lint, format, type checks, boundary checks, and tests

## Approval-dependent release gates

- [ ] Contract/security owners approve and execute the timelock remediation; finalized `getMinDelay()` must be at least `172800`
- [ ] `npm run verify:live:contract-wiring` passes every check after remediation
- [ ] PostgreSQL, Redis, RPC, and internal API credentials are rotated by their owners
- [ ] Exact production HTTPS frontend origin is configured
- [ ] Trusted ingress/rightmost `X-Forwarded-For` behavior and direct-access prevention are verified before enabling `TRUST_PROXY`
- [ ] Full current-revision indexer backfill and deeper/longer isolated staging reorg recovery pass, or indexer exclusion is formally approved
- [ ] Managed Redis restart/reconnect and outbox retry/dead-letter drill pass without flushing shared data
- [ ] Abrupt host/process-loss recovery for indexer and outbox is verified
- [ ] Production backup and isolated restore rehearsal are completed with integrity and timing evidence
- [ ] Production schema target and pending migrations are reviewed and explicitly approved
- [ ] Railway IaC plan is reviewed and approved; no destructive or unrelated resource change is present
- [ ] API deployment, authenticated readiness, and production smoke suite pass
- [ ] Indexer/outbox startup, lease/fence/cursor/backlog checks, and stabilization monitoring pass
- [ ] Contract ownership, security, operations, database, product, and release owners provide named approval
- [ ] Prior artifact, recovery point, rollback trigger/owner, and communications plan are recorded

## Current release verdict

The repository can be made deployment-ready through local verification, but production approval remains blocked until every approval-dependent gate above has evidence. No successful local command authorizes a transaction, migration, credential rotation, deployment, or shared-service test.
