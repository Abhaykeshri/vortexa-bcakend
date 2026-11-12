# Architecture, Security, and Integration Audit

Audit date: 2026-11-12

## Outcome

The current implementation already satisfies the requested baseline architecture. It is an Express 5 and TypeScript monorepo with framework-independent domain and application packages, dependency-injected presentation code, Drizzle/PostgreSQL repository adapters, Redis coordination, viem blockchain adapters, centralized configuration, and automated architecture/security tests.

No frontend UI source was changed during this audit. The existing frontend API client and its production build were verified against the backend route surface.

## Current architecture

```text
apps/api (Express routes, middleware, controllers, validators, presenters)
  -> packages/application (use cases and workflow orchestration)
    -> packages/domain (entities, value types, errors, and ports)
      <- packages/adapters (PostgreSQL/Drizzle, Redis, RPC, viem)

apps/indexer -> application services -> domain ports <- infrastructure adapters
apps/outbox  -> application worker   -> domain ports <- infrastructure adapters
```

Composition roots construct infrastructure and inject it into controllers and application services. Controllers do not issue SQL, and the domain package does not import Express, Drizzle, Redis, or viem. The automated boundary check also rejects import cycles and HTTP-layer SQL.

## Endpoint inventory

### Platform and projection API

| Method | Route                                | Access/policy                                                    |
| ------ | ------------------------------------ | ---------------------------------------------------------------- |
| GET    | `/health/live`                       | Public liveness probe                                            |
| GET    | `/health/ready`                      | Internal bearer key; browser origins rejected                    |
| GET    | `/api/v1/network`                    | Exact-origin CORS and distributed rate limit                     |
| GET    | `/api/v1/chain/status`               | Exact-origin CORS and distributed rate limit                     |
| GET    | `/api/v1/contracts/status`           | Exact-origin CORS and stricter distributed rate limit            |
| GET    | `/api/v1/contracts/wiring`           | Internal bearer key; browser origins rejected                    |
| GET    | `/api/v1/vaults`                     | Internal bearer key; cursor pagination and scoped response cache |
| GET    | `/api/v1/vaults/:address`            | Internal bearer key; validated address and pinned projection     |
| GET    | `/api/v1/vaults/:address/events`     | Internal bearer key; cursor pagination and stricter rate limit   |
| GET    | `/api/v1/wallets/:address/positions` | Internal bearer key; wallet-scoped cache identity                |

### V2 frontend API

| Method | Route                                          | Purpose                                 |
| ------ | ---------------------------------------------- | --------------------------------------- |
| GET    | `/v1/openapi.json`                             | OpenAPI 3.1 document                    |
| GET    | `/v1/shapes`                                   | Supported shape catalogue               |
| POST   | `/v1/shapes/preview`                           | Validate and preview shape geometry     |
| GET    | `/v1/chains/:chainId/vaults`                   | Vault list used by the frontend         |
| GET    | `/v1/chains/:chainId/vaults/:vault`            | Vault workspace detail                  |
| GET    | `/v1/chains/:chainId/vaults/:vault/bands`      | Vault bands                             |
| GET    | `/v1/chains/:chainId/vaults/:vault/activity`   | Vault activity                          |
| GET    | `/v1/chains/:chainId/vaults/:vault/history`    | Vault history                           |
| GET    | `/v1/chains/:chainId/vaults/:vault/rebalances` | Rebalance history                       |
| GET    | `/v1/chains/:chainId/users/:address/positions` | Wallet positions                        |
| GET    | `/v1/chains/:chainId/pools`                    | Supported pools                         |
| GET    | `/v1/chains/:chainId/limits`                   | Transaction limits                      |
| POST   | `/v1/chains/:chainId/tx/validate-config`       | Validate a proposed vault configuration |
| POST   | `/v1/chains/:chainId/tx/create-vault`          | Build an unsigned create-vault plan     |
| POST   | `/v1/chains/:chainId/quotes/deposit`           | Simulated deposit quote                 |
| POST   | `/v1/chains/:chainId/tx/deposit`               | Build an unsigned deposit plan          |
| POST   | `/v1/chains/:chainId/quotes/withdraw`          | Simulated withdrawal quote              |
| POST   | `/v1/chains/:chainId/tx/withdraw`              | Build an unsigned withdrawal plan       |
| POST   | `/v1/chains/:chainId/tx/manager/update`        | Build an unsigned manager update        |
| POST   | `/v1/chains/:chainId/tx/manager/rebalance`     | Build an unsigned manager rebalance     |

The transaction endpoints return unsigned transaction plans. The backend does not store a private key, sign transactions, or fabricate transaction hashes.

## Security controls verified

- Exact-origin CORS allowlist with credentials disabled and controlled preflight behavior.
- Helmet, API-oriented CSP, production HSTS, JSON escaping, and disabled `x-powered-by`.
- Bounded JSON bodies, content-length validation, malformed JSON handling, and method guards.
- Timing-safe bearer-key checks for internal endpoints without logging credentials.
- Redis-backed, route-specific distributed rate limiting that fails closed on protected routes.
- Server-generated request IDs and structured logs that omit bodies, query values, authorization headers, and credentials.
- Centralized, sanitized error mapping without production stack, SQL, or upstream-secret disclosure.
- Environment validation for URLs, origins, limits, contract addresses, production dependencies, and indexer safety policy.
- Graceful HTTP shutdown and explicit cleanup of injected PostgreSQL, Redis, and RPC dependencies.
- Restricted JSON-RPC methods, bounded timeouts/retries, chain verification, and runtime bytecode verification.
- Parameterized PostgreSQL access, fencing tokens, reorg-safe projections, and safe migrations.

The current API does not use cookie authentication. Origin-based CSRF protection is retained as a tested helper for a future cookie-authenticated state-changing route, but is intentionally not applied to bearer-free, credential-disabled transaction-plan endpoints.

## Pagination and cache identity

Projection list endpoints use stable ordering, validated bounds, opaque cursors scoped to route, chain, snapshot, and projection generation. Response keys preserve the required four-field contract:

```text
<route_name>:<version>:<cursor>:<limit>
```

Chain, resource, visibility, and projection generation are embedded in validated route/version segments. The absent cursor is normalized to `start`. Tests cover collisions across resource, cursor, and generation scopes.

## Frontend integration

The frontend centralizes backend access in `src/lib/v2-api.ts`, derives the base URL from `NEXT_PUBLIC_V2_API_URL`, and consumes the `/v1/chains/11155111/...` route family implemented by the backend. Requests do not contain backend secrets, and UI transaction flows receive unsigned plans for wallet submission.

The production frontend build completed successfully without source or UI changes. Frontend lint completed with one existing non-blocking unused-setter warning in `src/components/voult-deposit/workspace.tsx`.

## Verification evidence

Executed successfully on 2026-11-12:

- Backend secret scan.
- Hexagonal boundary, import-cycle, and HTTP SQL-isolation checks.
- Backend ESLint and Prettier checks.
- Main and Railway TypeScript builds.
- 100 backend unit, integration, security, HTTP, adapter, indexer, projection, and V2 API tests.
- Static migration/contract release-artifact verification.
- Backend production dependency audit: zero known vulnerabilities.
- Frontend ESLint: zero errors and one warning.
- Frontend Next.js production build and TypeScript validation.

Live RPC, deployed-contract, PostgreSQL, Redis, migration, staging-reorg, and production smoke commands were not run because they require approved targets and credentials. No production data or infrastructure was mutated.

## Release blockers and follow-up

The frontend production dependency audit currently reports 43 advisories (5 moderate, 37 high, and 1 critical), including the resolved Next.js and transitive wallet/Web3 dependency graph. The audit reports no automatic fix for the current graph. This is a release blocker that requires coordinated dependency upgrades or upstream patched releases followed by a complete wallet, build, and UI regression test; forced major substitutions were not made during this audit.

Before a production release, operators must also complete the credentialed live verification commands documented in `README.md` and confirm database backup/restore readiness before applying migrations.

## Adding a future module

1. Define domain types, invariants, and errors without framework imports.
2. Define the required application/domain port.
3. Implement an application use case that depends only on that port.
4. Implement infrastructure adapters (Drizzle for new relational persistence) behind the port.
5. Add strict Zod request schemas, a controller, presenter mapping, and a versioned Express route.
6. Register dependencies only in the relevant composition root.
7. Apply authentication, authorization, CORS, rate limits, payload limits, and CSRF policy appropriate to the route's threat model.
8. For paginated caches, use the shared four-part cache-key builder with every user, tenant, filter, sort, chain, resource, and authorization dimension represented safely.
9. Add domain, application, adapter, HTTP, integration, and security tests plus OpenAPI documentation.
10. Run `npm run check` and the applicable credentialed verification before release.
