# VortexA Backend Refactoring and QA Report

Date: 2026-11-04

Branch: `feature/m7-express-migration`

Scope: Express/MVC presentation, application services, adapters, tests, operational scripts, documentation, and read-only Sepolia verification

## Outcome

The backend is organized by business and technical responsibility rather than delivery history. Express routes, controllers, validators, presenters, application services, domain ports, and infrastructure adapters retain their original dependency direction. Public API paths, environment variables, database objects, migration history, deployed contract identifiers, ABIs, addresses, and business behavior were preserved.

Local build, automated tests, lint, formatting, boundary checks, production dependency audit, and secret scanning pass. All 15 configured Sepolia addresses contain runtime bytecode matching the pinned manifest hashes.

The deployment is not ready for release approval because the read-only wiring verifier found an on-chain timelock policy mismatch: the deployed controller reports a zero-second delay instead of the required minimum of 172,800 seconds.

## Responsibility-based organization

Important source names now describe their roles:

| Responsibility | Current source |
|---|---|
| Vault read/query orchestration | `packages/application/src/vault-query.service.ts` |
| Blockchain indexing and reorg coordination | `packages/application/src/blockchain-indexer.service.ts` |
| Pinned projection refresh | `packages/application/src/projection-refresh.service.ts` |
| Projection parity checks | `packages/application/src/projection-reconciliation.service.ts` |
| Vault commands and capability use cases | `packages/application/src/vault-use-cases.ts` |
| Durable notification delivery | `packages/application/src/notification-outbox.worker.ts` |
| PostgreSQL vault projections | `packages/adapters/src/postgres/vault-projection.repository.ts` |
| PostgreSQL indexer persistence | `packages/adapters/src/postgres/postgres-indexer.repository.ts` |
| Redis cache, leases, rate limits, notifications | `packages/adapters/src/redis-coordination.adapter.ts` |
| Sepolia JSON-RPC | `packages/adapters/src/sepolia-rpc.adapter.ts` |
| ABI contract reads | `packages/adapters/src/contract-reader.adapter.ts` |
| Viem indexer source and event decoding | `packages/adapters/src/indexer/viem-indexer-source.adapter.ts` |
| Vault HTTP presentation | `apps/api/src/controllers/vault-query.controller.ts` |
| Express security and lifecycle middleware | `apps/api/src/middleware/http.middleware.ts` |

Operational commands were similarly renamed around contract verification, infrastructure verification, indexer verification, projection verification, and staging reorg verification.

## Architecture and security

- `createApp()` constructs the complete Express application without binding a port.
- `startApiServer()` owns listening, timeout policy, signals, and dependency cleanup.
- Routes declare endpoints and middleware; controllers invoke application services; validators and presenters own HTTP-specific mapping.
- Controllers contain no SQL and do not construct PostgreSQL, Redis, RPC, or contract adapters.
- Application services import domain ports rather than infrastructure packages.
- `express-rate-limit` uses the existing Redis counter through a distributed store. Rate-limited routes fail closed when Redis is missing or unavailable; there is no process-local security fallback.
- Helmet, exact-origin CORS, timing-safe bearer validation, payload limits, malformed JSON handling, request IDs, JSON escaping, and centralized error sanitization remain active.
- Cache keys retain the four logical fields `<route>:<version>:<cursor>:<limit>` with chain/resource scope in the route field and projection generation in the version field.
- Blockchain quantities remain `bigint` internally and exact decimal strings over HTTP.

## Removed duplication and dead code

- Removed the obsolete native-HTTP projection adapter after transferring its validation coverage to shared validators and Express integration tests.
- Removed legacy manual security-header and JSON-stringification helpers that were used only by pre-Express tests; Helmet and Express JSON escaping are now verified through HTTP integration tests.
- Corrected the test runner to derive compiled tests from current TypeScript source names, preventing renamed stale files in `dist` from executing twice.
- Moved contract wiring verification under `scripts/` and corrected its compiled-module paths.
- Updated the wiring verifier to report every check and a complete pass/fail summary instead of terminating on the first mismatch.

## Compatibility identifiers intentionally preserved

The following historical identifiers were not renamed because they are externally consumed or persisted:

- Migration filenames and migration ledger identifiers
- Physical PostgreSQL table names such as `m7_projection_state`
- Environment variables beginning with `M7_`
- Deployed contract names `VaultM5Module` and `VaultM6Module`
- Existing indexer consumer and Redis lease resource values used by deployed cursors and fencing state

Changing these identifiers would break database checksums, deployment configuration, contract ABI lookup, or worker continuity.

## Verification evidence

| Check | Result | Evidence |
|---|---|---|
| TypeScript build | PASS | `npm run build` exited 0 |
| Automated tests | PASS | 88 passed, 0 failed, 0 skipped |
| Express integration | PASS | App factory, routes, Helmet, CORS, bearer auth, Redis rate limits, payload/JSON errors, request IDs, sanitized errors, shutdown |
| Hexagonal boundaries | PASS | No domain/application dependency inversion, HTTP SQL, or import cycle detected |
| ESLint | PASS | Zero errors and zero warnings |
| Prettier | PASS | Repository formatting applied and verified |
| Secret scan | PASS for tracked/project files | Local environment files are excluded from content scanning and Git tracking |
| Production dependency audit | PASS | `npm audit --omit=dev`: 0 vulnerabilities |
| Full dependency audit | PARTIAL | 11 moderate, 0 high, 0 critical; all findings are in the ESLint/TypeScript-ESLint development toolchain through `minimatch` |
| ABI validation | PASS | 15 ABI arrays; functions, events, errors, overloads, and tuples validated |
| Runtime bytecode verification | PASS | 15 of 15 addresses contain bytecode matching pinned Keccak-256 hashes |
| Contract ABI reads and wiring | PARTIAL | 58 passed, 1 failed at finalized block `12061760` |

## Contract verification blocker

| File/check | Error | Impact | Required action |
|---|---|---|---|
| `scripts/verify-contract-wiring.mjs` | Timelock delay is `0` seconds; required minimum is `172800` seconds | Governance operations are not protected by the expected 48-hour delay, so release approval must remain blocked | Contract owner must confirm the intended policy and configure or redeploy the timelock through an explicitly authorized on-chain process; then rerun `npm run verify:live:contract-wiring` |
| `package.json` development dependencies | Full `npm audit` reports 11 moderate findings in the ESLint/TypeScript-ESLint dependency graph; production audit reports zero | Does not affect the deployed runtime bundle, but untrusted glob input in developer tooling could consume excessive resources | Upgrade the lint toolchain when mutually compatible patched releases are available; do not apply the audit's suggested major-version downgrades blindly |

Runtime hash verification still passes for the TimelockController. The failure is configuration/policy state, not missing bytecode.

## Sensitive local file observation

`.env.backup` is Git-ignored but contains a credential-bearing service URL. No secret value was printed, modified, or deleted. Treat any credentials stored there as potentially exposed through local backups: rotate the affected database or Redis credential if it has ever been shared, copied, or uploaded, and prefer a managed secret store.

## Verification not performed

- No production or shared database migration
- No PostgreSQL or Redis mutation integration test against unconfirmed infrastructure
- No worker deployment or process restart
- No blockchain transaction, contract deployment, or timelock modification
- No commit, push, or merge

## Release conclusion

The refactored source is locally buildable, tested, and structurally compliant. Sepolia deployments and ABI reads are available, but release approval remains blocked by the zero-second on-chain timelock delay and the previously documented operational gates that require authorized infrastructure and real projection samples.
