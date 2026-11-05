# VortexA Backend

VortexA Backend is a Sepolia-only TypeScript service for contract discovery, finalized-chain indexing, durable projections, and read-only vault APIs. It uses Express, PostgreSQL with Drizzle ORM, Redis, viem, and strict hexagonal boundaries.

The backend never stores a private key, signs a transaction, deploys a contract, or fabricates blockchain state. Vault creation occurs through the `VaultFactory` contract; the indexer discovers emitted vaults and the API exposes their persisted projections.

## Architecture

```text
Express routes
  -> HTTP middleware
  -> Controllers and validators
  -> Application services
  -> Domain ports
  -> PostgreSQL, Redis, and Sepolia adapters
```

- `apps/api`: Express application factory, MVC presentation layer, middleware, and process startup.
- `apps/indexer`: independently runnable finalized-chain indexer.
- `apps/outbox`: independently runnable durable notification worker.
- `packages/domain`: entities, value types, validation, errors, and port contracts.
- `packages/application`: framework-independent use cases and orchestration services.
- `packages/adapters`: Drizzle/PostgreSQL, Redis, RPC, viem, and contract-reader adapters.
- `packages/contracts`: the canonical Sepolia deployment manifest.
- `tests`: deterministic unit, security, adapter, indexer, and HTTP integration tests.

Controllers do not query PostgreSQL or Redis directly. Application services depend on domain ports, while infrastructure adapters implement those ports.

## Requirements

- Node.js 22 or newer
- PostgreSQL for durable state and projections
- Redis for distributed rate limits, leases, caching, and notifications
- A read-only Ethereum Sepolia JSON-RPC endpoint

## Local setup

```powershell
npm ci
Copy-Item .env.example .env
# Configure local secrets and infrastructure URLs in .env.
npm run build
npm test
npm run start
```

Only `.env` is loaded outside production. Production configuration must come from process environment variables. `.env`, `.env.backup`, credentials, and generated secrets are Git-ignored and must never be committed.

The public deployment addresses in `.env.example` and the canonical manifest are not secrets. `CONTRACT_VAULT` identifies the Vault implementation and must not be treated as a factory-created user vault.

## HTTP API

| Endpoint | Purpose | Policy |
|---|---|---|
| `GET /health/live` | Process liveness | Server probe |
| `GET /health/ready` | RPC, contract, PostgreSQL, and Redis readiness | Internal bearer key; browser origins rejected |
| `GET /api/v1/network` | Active chain, manifest, addresses, confirmation depth | Exact CORS and distributed rate limit |
| `GET /api/v1/chain/status` | Latest and safe-confirmation blocks | Exact CORS and distributed rate limit |
| `GET /api/v1/contracts/status` | Runtime deployment status | Exact CORS and strict distributed rate limit |
| `GET /api/v1/contracts/wiring` | Critical factory, Zap, and executor wiring | Internal bearer key; browser origins rejected |
| `GET /api/v1/vaults` | Stable paginated vault catalog | Exact CORS and distributed rate limit |
| `GET /api/v1/vaults/:address` | One pinned vault projection | Exact CORS and distributed rate limit |
| `GET /api/v1/vaults/:address/events` | Canonical vault events | Exact CORS and stricter distributed rate limit |
| `GET /api/v1/wallets/:address/positions` | Pinned wallet positions | Exact CORS and distributed rate limit |

Unsupported methods return `405 METHOD_NOT_ALLOWED`. Blockchain quantities are serialized as exact decimal strings.

List endpoints accept `chainId`, `cursor`, and `limit`. Cursors are bound to the route, chain, projection generation, and snapshot block. Projection changes therefore invalidate stale cursors instead of mixing snapshots.

Response cache keys preserve the logical contract:

```text
<route_name>:<version>:<cursor>:<limit>
```

Chain, resource, visibility scope, and projection generation are embedded deterministically in the route and version fields.

## Security controls

- Helmet with an API-only content security policy and production HSTS
- Exact-origin CORS allowlist
- Timing-safe bearer API-key validation for internal routes
- Redis-backed distributed rate limits that fail closed
- Bounded JSON request bodies and malformed JSON handling
- Server-generated request identifiers
- JSON escaping and `nosniff` responses
- Sanitized centralized error handling
- Restricted JSON-RPC method allowlist, timeouts, retries, and provider failover
- Runtime contract-bytecode hash verification
- PostgreSQL fencing tokens and owner-safe Redis leases

The service does not use cookie authentication. The CSRF policy is retained for any future cookie-authenticated state-changing route and is intentionally not applied to bearer-only reads.

## Contracts and ABIs

The canonical manifest contains 15 Sepolia deployments with pinned runtime hashes. ABI files are under `packages/adapters/abis`; `provenance.json` records the source branch, commit, export time, and missing/ambiguous export status.

Run the read-only deployment verification with:

```powershell
npm run verify:live:contracts
npm run verify:live:contract-wiring
```

These commands read chain state only and never submit a transaction.

## Persistence and workers

PostgreSQL is canonical. Redis is an ephemeral coordination layer and cannot replace durable database state.

```powershell
npm run migrate             # Requires an approved target and backup
npm run indexer:start       # Separate process
npm run outbox:start        # Separate process
npm run indexer:replay -- --from <block> --to <block>
npm run indexer:reconcile
```

Migration filenames and physical projection table names retain their historical identifiers because changing them would break migration checksums and existing deployments.

The indexer verifies the RPC chain before writes, freezes each catch-up head, fetches bounded log ranges, decodes ABI events, commits logs/projections/cursors atomically, detects reorgs, rolls back orphaned projections, and replays canonical events. Worker identity strings already persisted by deployed environments are also kept stable for cursor and lease continuity.

## Quality and verification

```powershell
npm run build
npm test
npm run check:boundaries
npm run scan:secrets
npm run lint
npm run format:check
npm audit
npm run verify:release:static
```

Optional verification commands:

```powershell
npm run verify:live:contracts
npm run verify:live:contract-wiring
npm run inspect:timelock
npm run verify:live:indexer
npm run verify:live:projections
npm run verify:live:infrastructure      # Mutates only an explicitly approved isolated target
npm run verify:staging:indexer-reorg    # Requires an explicitly approved staging target
npm run smoke:production                # Read-only; requires an approved HTTPS target and operator key
```

Do not run migration or infrastructure verification commands against production without target confirmation, a verified recovery point, and operator approval.

## Documentation

- [Express migration and QA](docs/EXPRESS_MIGRATION_QA_REPORT.md)
- [V2 UI API and frontend integration](docs/V2_UI_API.md)
- [V2 indexer catch-up plan](docs/V2_INDEXER_CATCHUP_PLAN.md)
- [Blockchain indexer architecture](docs/BLOCKCHAIN_INDEXER_ARCHITECTURE.md)
- [Reorg recovery](docs/REORG_RECOVERY.md)
- [Indexer replay and reconciliation](docs/INDEXER_REPLAY_AND_RECONCILIATION.md)
- [Vault query API and cache](docs/VAULT_QUERY_API_AND_CACHE.md)
- [Pinned projection reconciliation](docs/PINNED_PROJECTION_RECONCILIATION.md)
- [Database schema](docs/DATABASE_SCHEMA.md)
- [Production readiness checklist](docs/PRODUCTION_READINESS_CHECKLIST.md)
- [Railway deployment guide](docs/RAILWAY_DEPLOYMENT_GUIDE.md)
- [Backup and restore runbook](docs/BACKUP_AND_RESTORE_RUNBOOK.md)
- [Incident recovery runbook](docs/INCIDENT_RECOVERY_RUNBOOK.md)
- [Observability and alerting](docs/OBSERVABILITY.md)
- [Rollback runbook](docs/ROLLBACK_RUNBOOK.md)
- [Timelock remediation](docs/TIMELOCK_REMEDIATION.md)

Historical delivery reports retain milestone terminology only as evidence of what was tested at that time; current source organization and operational commands are capability-based.
