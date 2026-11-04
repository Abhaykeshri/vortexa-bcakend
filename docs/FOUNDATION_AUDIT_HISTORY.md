# M0-M5 audit and gap analysis

Audit date: 2026-11-02. Sources: the 11-page client backend guide M0-M19, this backend tree, and the Solidity repository at `C:\Users\Abhay\Desktop\vortexa-core-smrtcontract`. The Solidity repository was inspected but not modified. The backend directory is not a Git repository, so branch, history and diff-based provenance are unavailable.

## Milestone matrix

| Milestone | Requirements found | Existing/implemented evidence | Remaining gap | Status |
|---|---|---|---|---|
| M0 | Traceability, threat model, role matrix, ADR/control decisions, risk owners and measurable acceptance | Guide scope recorded here; threats and open risks in security/remaining-work reports | Named backend, contract, security and operator owners and formal approval are not supplied | PARTIAL |
| M1 | Strict TS monorepo, locked deps, CI, lint/format, boundary/secret checks, runnable API, central config, Windows/PM2 docs | Workspaces, strict TS, lockfile, CI, ESLint, Prettier, boundary/secret scan, ignored `.env`, API/PM2 docs; Node 22.23.4 build/tests/runtime pass | Backend lacks Git history and clean-checkout provenance | PARTIAL |
| M2 | Domain entities, ports, use cases, mocks, error taxonomy, deterministic negative tests | Vault/position/strategy/shape/capability/rebalance/event/intent/portfolio types; repository/event/cache/lease/signer ports; mocks; deterministic tests | Full business use cases for later M6+ workflows intentionally not implemented | PASS for M2 scope |
| M3 | ENV-driven addresses, versioned hash manifest, pinned ABIs, Sepolia reads, failover, block tags, role/wiring/readiness evidence | 12 required ENV addresses, address-free hash manifest, 12 exact ABI and normalized deployed-bytecode matches, failover adapter, finalized-block reads, 56/56 live checks, readiness hash gate | Release authority still must approve the environment and manifest for production promotion | PASS technically |
| M4 | Drizzle normalized schema, migrations/indexes/constraints, repositories, concurrency/rollback/restore evidence | 13-table Drizzle schema, transactional checksummed migration, rollback SQL, schema diagram/runbook, live isolated repeat/CRUD/constraints/concurrency/rollback | No authorized production migration or Railway PITR/restore rehearsal | PARTIAL |
| M5 | Redis cache/rate limits/notifications, durable PG outbox/jobs, leases, TTLs/namespaces/idempotency/retry/DLQ/outage fallback | Namespaced adapter, fail-closed controls, owner-token leases, durable outbox/jobs, worker retry/dead-letter policy; live expiry takeover/reconnect | Managed service restart drill and M6 reorg-driven invalidation remain external/future gates | PARTIAL |

## Role matrix

| Role | Authority | Prohibited without explicit approval |
|---|---|---|
| Backend owner | API, adapters, migrations and release evidence | Contract ownership/role changes and production migration |
| Contract lead | ABI, deployment manifest and on-chain role approval | Backend secrets and database administration |
| Security reviewer | Independent privileged-path and release-blocker review | Self-approving implementation findings |
| Operator | Railway/PM2/TLS/backups, secret rotation and rollback | Changing business rules or enabling a signer |
| Release authority | Signed go/no-go after evidence review | Waiving critical/high findings without recorded risk acceptance |

## Architecture and dependencies

Domain code has no framework/viem/Redis/Drizzle imports. Application use cases depend on domain ports. Outbound adapters implement Sepolia RPC, ABI reads, PostgreSQL repositories and Redis coordination. PostgreSQL owns durable outbox/job state; Redis is ephemeral and cannot grant authorization when unavailable. The API remains read-only.

M3 depends on the reviewed Solidity ABIs/deployment. M4 depends on approved Railway migration and backup policy. M5 depends on M4 durability; M6 will consume the cursor/header/log/outbox foundation.

PASS means the guide's exit gate was executed with evidence. PARTIAL is used when code exists but an approval, independent review, production operation or resilience drill is absent. Historical results were not treated as current proof.
