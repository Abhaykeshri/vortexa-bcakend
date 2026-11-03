# VortexA Backend M0-M7 Complete QA Report

Date: 2026-11-03
Scope: current working tree, M0-M7, read-only live checks, local and deterministic synthetic tests
Baseline: `VortexA_Backend_Developer_Guide_Client_Edition_M0-M19.pdf` plus the Raj Mazumder controls in the QA assignment

## A. Executive summary

**Overall result: PARTIAL. The reviewed M0-M7 implementation is locally functional, but it is not production-release ready and M7 has not passed its official live exit gate.**

| Evidence class | Result | Evidence |
| --- | --- | --- |
| Local build/static gates | PASS on Node 20 only (previously recorded) | Build, typecheck, ESLint, Prettier, boundary/cycle/SQL-layer checks and secret scan pass; not rerun in this closure |
| Final automated regression | PASS | `npm test`: 80/80 tests, 0 failed, 0 skipped |
| Focused M7 regression | PASS | 10/10, including finalized-snapshot proof and mandatory positive-holder mismatch cases |
| Local HTTP smoke | PASS, bounded | Liveness, request ID, headers, method rejection, oversized `Content-Length`, CORS rejection and clean signal shutdown |
| Isolated PostgreSQL/Redis integration in this run | NOT RUN | The verifier creates/drops a PostgreSQL schema and writes/deletes Redis keys; no separately provisioned disposable targets were proven, so Railway was not used |
| Current Railway read-only schema/connectivity | PASS (provided evidence) | PostgreSQL and Redis reachable; 19/19 expected tables and migrations `0001`-`0004` present |
| Synthetic indexer/reorg/reconciliation | PASS | Deterministic mocks cover replay, same-transaction discovery, crash-before-commit, shallow/deep reorg, finality and pinned parity |
| Read-only Sepolia M3 | PASS | 56/56 at a finalized block; 12 runtime hashes plus ABI reads, wiring, ownership and timelock checks |
| Read-only Sepolia M6 | PASS, bounded | 10 logs decoded over a bounded range; canonical confirmed/finalized heads checked |
| Official M7 live gate | BLOCKED | Factory `vaultCount = 0`; no projection state, finalized sample or positive holder exists |
| Node.js 22+ compliance | NOT VERIFIED | The previous recorded runtime was Node `v20.20.2`; a fresh version check was not permitted in this closure, and the project declares `node >=22` |
| Production readiness | BLOCKED | Node 22 release evidence, live M7 sample/parity, indexer catch-up, restore proof and named approvals remain open |

No production migration, database write, Redis key mutation, worker start, deployment or Sepolia transaction was performed. The already-applied Railway migrations were not rerun. Regression, M7 focused tests, M3/M6 live checks, schema status, and npm audit results above are the supplied evidence; no build, test suite, or migration was rerun for this closure.

Two verified defects were corrected:

1. API JSON responses did not consistently carry a request ID. A server-generated UUID is now returned in both `X-Request-Id` and JSON bodies, including fallback errors.
2. `verify-m3-wiring.mjs` passed the pinned block as ABI arguments after the reader signature changed. The verifier now supplies an empty ABI argument list and the pinned block separately; the read-only live gate passes 56/56.

## B. Milestone matrix

| Milestone | Requirement and test | Type | Result | Evidence | Remaining gap |
| --- | --- | --- | --- | --- | --- |
| M0 | Traceability, threat model, decisions, role boundaries, source-of-truth rules | Documentation/code reconciliation | PARTIAL | Architecture/security/runbooks and milestone evidence exist; PostgreSQL is canonical and Redis is explicitly non-canonical | Named backend, contract, security, operations and release approvals are external |
| M1 | Strict TS monorepo, hexagonal boundaries, adapter direction, no HTTP SQL, no cycles, startup/shutdown | Static plus local HTTP | PASS locally | Build/typecheck/lint/format pass; expanded boundary checker passes; signal shutdown logs completion | Node 22 and clean-checkout CI/release artifact evidence BLOCKED here; implementation uses native Node HTTP rather than the guide's stated Fastify target |
| M2 | Domain/value validation, ports/use cases, failures, deterministic mocks, BigInt | Unit | PASS | Address/chain/amount/strategy, capability, simulation and adapter-failure tests pass; numeric quantities remain `bigint`/decimal strings | Full property/fuzz testing was intentionally NOT RUN |
| M3 | Sepolia chain enforcement, 12 contracts, manifest/ABI/runtime identity, wiring, RPC failures, pinned reads | Unit plus read-only live | PASS technically | Artifact equivalence 12/12; live wiring 56/56; wrong-chain, allowlist, failover, malformed/429/timeout cases pass | Environment/manifest promotion approval remains external |
| M4 | Four migrations, schema/Drizzle/repositories, constraints, transactions, concurrency, restore | Static, mock repository, read-only schema | PARTIAL | Four up/down pairs exist; current Railway ledger `0001`-`0004` and 19/19 tables are verified read-only; parameterization, BigInt and fencing tests pass | No destructive/transactional integration was run against Railway; an isolated disposable PostgreSQL target and restore drill are not evidenced in this closure; PITR evidence absent |
| M5 | Redis namespace, rate limits, leases/fencing, durable outbox, retries/DLQ, cache TTL/invalidation/outage | Unit plus read-only connectivity | PARTIAL | Cache hit/miss/fallback, key scoping, TTL arguments, owner-safe leases, concurrent rate threshold, durable outbox retry/dead-letter pass; Redis reachable | No key-writing expiry/reconnect test was run against Railway; a separate disposable Redis target and managed recovery drill are not evidenced in this closure |
| M6 | Backfill, canonical ingest, durable cursor, replay, reorg, finality, contention/fencing, reconciliation | Synthetic plus bounded read-only live | PASS locally; PARTIAL operationally | Same-transaction discovery, idempotent resume, crash-before-commit, shallow rollback, deep-reorg fail-closed, finality promotion and stale fencing pass; bounded live verifier passes | Full deployment-block catch-up, live restart/resume, managed failover and deep approved staging drill NOT RUN |
| M7 | Vault projections/read APIs, cache generation, stale/finality metadata, pinned vault and positive-holder parity | Unit/handler/synthetic plus read-only live | PASS synthetic; BLOCKED live | Supplied focused tests 10/10; current schema has migration `0004`; verifier is read-only | Factory `vaultCount=0`; projection state and finalized vault/positive-holder samples are absent; real pinned parity is blocked |

### Documentation reconciliation

- The current read-only schema evidence proves migrations `0001` through `0004` are applied. M7 documentation has been reconciled to this status; this closure did not run migrations.
- The guide describes Fastify/Zod/OpenAPI-oriented delivery. The current runtime uses native Node HTTP and manual validation. The tested controls work, but framework/OpenAPI conformance is not present in M0-M7; OpenAPI is principally a later guide milestone.
- Contract deployment addresses are required validated `CONTRACT_*` environment variables. The checked-in manifest intentionally contains runtime hashes, not production addresses. No production deployment address was found hard-coded in runtime source; the zero address used in indexer logic is the ERC-20 mint/burn sentinel.

## C. Raj Mazumder compliance matrix

| Control | Result | Evidence / qualification |
| --- | --- | --- |
| Hexagonal architecture | PASS | Domain has no infrastructure imports; application has no adapter/framework/database imports; cycle check passes |
| Adapter pattern | PASS | Chain, repository, cache, indexer source/store and pinned-reader ports have replaceable deterministic test adapters |
| CORS | PASS | Exact allowed origins, multiple origins, preflight, missing server Origin, disallowed/null Origin and no credential allowance tested |
| Helmet/security headers | PASS equivalent | Native implementation returns CSP, nosniff, frame denial, referrer policy, COOP/CORP and production HSTS; no Helmet dependency is used |
| XSS | PASS for JSON API | Markup/script-like values remain JSON data and `<`, `>`, `&`, U+2028/U+2029 are escaped in serialized output; no HTML sink exists |
| API key authentication | PASS | Internal routes require a valid bearer key, use timing-safe comparison, reject browser origins and do not echo credentials |
| Payload limits | PARTIAL | Bounded and oversized `Content-Length` cases pass; M0-M7 exposes read-only GET routes, so malformed JSON/content-type mutation handling is NOT APPLICABLE to current routes |
| CSRF | NOT APPLICABLE to current API | Current routes are bearer-authenticated internal GETs or public GETs with no cookie authentication; helper fails closed for future cookie-authenticated unsafe methods |
| Redis-backed rate limiting | PASS in unit behavior; PARTIAL live | Threshold, concurrency, proxy bypass defense and fail-closed outage behavior pass; live rate-counter mutation was not authorized |
| Drizzle ORM | PASS implementation; PARTIAL integration | Drizzle schemas/repositories compile and mapping tests pass; isolated real-PostgreSQL exercise BLOCKED this run |
| Redis cache key | PASS | Logical `route:version:cursor:limit` fields are preserved with chain, filters, resource/wallet/vault and generation scopes |
| Cache TTL | PASS unit; BLOCKED real expiry | Bounded TTL propagation is asserted; actual Redis wall-clock expiry was not mutated on Railway |
| Cache invalidation | PASS synthetic | Projection generation and cursor scope prevent stale/reorg collision; live Redis invalidation was not performed |

Cursor structure, route, filters, snapshot and generation binding are tested. Cryptographically signed cursor tamper protection and expiry are later guide concerns (M9), so those two requirements are **NOT APPLICABLE** to the M0-M7 implementation rather than silently claimed as passing.

## D. Infrastructure

| Component | Result | Safe evidence |
| --- | --- | --- |
| PostgreSQL | PARTIAL | Configured/reachable and schema is current (19/19, four migrations); all checks were read-only. No disposable local server was available for mutation tests |
| Redis | PARTIAL | Configured/reachable; production/shared keys were not created, changed or deleted. Unit fakes cover command behavior |
| Sepolia RPC | PASS read-only | Chain `11155111`; M3 56/56, artifact equivalence 12/12 and bounded M6 verification pass; no transaction was sent |
| Environment | PARTIAL | Central loader validates chain, 12 addresses, URL schemes, multi-origin CORS, pagination, TTLs and rate limits; `.env` is Git-ignored and excluded from secret scan |
| Dependencies | PASS | `npm ls --all --omit=optional` succeeds; `npm audit --omit=dev --audit-level=high` reports 0 vulnerabilities |
| Runtime | BLOCKED | Node `v20.20.2` was available; required Node 22+ was not. Results demonstrate compatibility on Node 20, not release compliance |

Secrets and credential values were neither printed nor placed in this report.

## E. Dummy data and isolation

| Fixture/effect | Result |
| --- | --- |
| In-memory multiple vaults, positive/zero holders and multiple block heights | PASS |
| Multiple distinct strategy contracts and multiple distinct holder wallets in one scenario | PARTIAL: types/scoping are covered, but one combined multi-strategy/multi-wallet fixture is absent |
| Factory `VaultCreated` followed by a newly discovered vault `Transfer` in the same transaction | PASS |
| Canonical/replaced blocks, replay, shallow/deep reorg and crash-before-commit | PASS |
| Observed projection independently proven finalized by exact canonical hash | PASS |
| Positive-holder direct shares and token0/token1 exposure match/mismatch | PASS |
| Cache cursor/limit/filter/wallet/vault/generation collision attempts | PASS |
| Outbox delivery, retry/dead-letter and unique claim owner | PASS |
| Deposits/withdrawals as fabricated events | NOT RUN: unsupported event semantics were not invented |
| Isolated PostgreSQL seed/cleanup | BLOCKED: no proven disposable database was available |
| Isolated Redis key creation/expiry/cleanup | BLOCKED: no proven disposable Redis was available |

All executed dummy data lived in process memory. Cleanup was automatic on process exit and could not target Railway resources.

## F. Security findings

| Finding | Severity | Evidence | Fix status |
| --- | --- | --- | --- |
| API responses lacked a consistent request identifier | Medium | Local HTTP/API review found no server-generated ID in response body/header | FIXED and regression tested |
| M3 live verifier supplied pinned block in the ABI argument slot | Medium QA correctness | Reproduced `AbiEncodingLengthMismatchError`; reader signature expects `args, blockNumber` | FIXED; live read-only verifier now 56/56 |
| Release runtime not verified on Node 22+ | High release blocker | Previous recorded host version is Node 20.20.2; package requires >=22; fresh runtime query not permitted in this closure | OPEN; verify runtime on approved Node 22+ host |
| Official M7 verifier has no real vault/holder/projection sample | High release blocker | `vaultCount=0`, projection state null, no finalized vault/holder parity | OPEN; requires approved on-chain/sample/indexer work |
| Production backup/restore proof absent | High operational blocker | Runbook exists but no current isolated restore evidence | OPEN |
| Isolated PostgreSQL/Redis integration not evidenced in this closure | Medium evidence gap | Verifier writes schema/data and Redis keys; Railway endpoints are not disposable | OPEN; provision and independently verify separate disposable targets before running |

No high-severity source vulnerability was found in the locally executed read-only scope. This is engineering QA, not an independent penetration test or production approval.

## G. Regression results

| Command/check | Result |
| --- | --- |
| `npm test` | PASS, 80/80; 0 failed, 0 skipped |
| Focused `dist/tests/m7.test.js` | PASS, 10/10 |
| `npm run build` / `npm run typecheck` | PASS on Node 20 |
| `npm run lint` | PASS, zero warnings |
| `npm run format:check` | PASS |
| `npm run check:boundaries` | PASS: domain/application direction, HTTP SQL isolation and import cycles |
| `npm run scan:secrets` | PASS: 114 files; local `.env` excluded |
| `npm audit --omit=dev --audit-level=high` | PASS: 0 vulnerabilities |
| `npm run verify:live:artifacts` | PASS, 12/12 ABI/runtime artifact equivalence |
| `npm run verify:live:m3` | PASS, 56/56 at finalized block `12055314` |
| `npm run verify:live:m6` | PASS bounded range `12032363-12032735`; 10/10 logs decoded, 0 unknown |
| `npm run verify:production:schema` | PASS read-only: 19/19 tables, migrations `0001`-`0004` |
| `npm run verify:live:m7` | BLOCKED as designed, exit 2; no live sample/projection |
| Isolated PostgreSQL/Redis mutation verification | NOT RUN in this closure; it can be safe only when both configured endpoints are independently confirmed disposable and not Railway production |

The final complete suite was run once after focused fixes, as requested for limited thermal headroom.

## H. Official M7 live gate

This gate is deliberately separate from synthetic PASS results.

| Gate item | Current result |
| --- | --- |
| Migration `0004_m7_vault_catalog` | PASS: present in the read-only migration ledger |
| Factory vault sample | BLOCKED: on-chain `vaultCount = 0` |
| M7 projection state | BLOCKED: null |
| Finalized pinned snapshot | BLOCKED: no vault projection/sample exists |
| Positive holder sample | BLOCKED: no vault and no holder with shares > 0 |
| Direct vault/holder parity | BLOCKED: cannot execute without the above samples |
| Verifier blockers | At minimum `NO_FACTORY_VAULT_SAMPLE`, `M7_PROJECTION_STATE_MISSING`, `FINALIZED_VAULT_SAMPLE_MISSING`; exact output can change with live state |

### Read-only indexer startup preflight (prepared; not executed)

Before any authorized worker start, inspect all of the following read-only and do not start if any state is ambiguous:

1. In Railway's service/instance view and any approved process supervisor, identify active indexer instances for chain `11155111` and record their deployment/worker identity. Do not copy environment values or secrets. Database status alone is not proof that a process is or is not alive.
2. On the exact intended Redis database, inspect only `EXISTS chain_11155111_m6_indexer` and `PTTL chain_11155111_m6_indexer`; if inspection of the owner is necessary, redact it. A positive TTL means a lease is held. Do not scan keys, alter, renew, release, or delete a lease during preflight.
3. Read the PostgreSQL row for `chain_id=11155111, consumer='m6-indexer'` from `indexer_worker_state` (`status`, `fence_token`, `updated_at`, `last_success_at`, `last_error`). The fencing token changes when a worker starts; preflight must not acquire one.
4. Read the matching `cursors` row and its `headers` record. Confirm the cursor hash is canonical at the same height and inspect its stored finality. Compare the block hash and finalized head through the approved RPC using read-only calls.
5. Read `m7_projection_state` (`generation`, `indexed_through_block`, `indexed_block_hash`, `finality`) and verify its hash is canonical and its block is finalized. Check the `balances` row for the sample holder has positive shares and agrees with the same pinned snapshot.
6. Require agreement among process inventory, Redis lease, PostgreSQL worker/fence row, cursor/header and projection state. A stale `RUNNING` row, a live lease without a known owner, conflicting cursor/hash, or another active process is a NO-GO. Do not start a second worker to “test” lease behavior.

Read-only PostgreSQL queries for the approved database (no writes):

```sql
SELECT status, fence_token, updated_at, last_success_at, last_error
FROM indexer_worker_state
WHERE chain_id = 11155111 AND consumer = 'm6-indexer';

SELECT block_number, block_hash, updated_at
FROM cursors
WHERE chain_id = 11155111 AND consumer = 'm6-indexer';

SELECT h.block_number, h.block_hash, h.canonical, h.finality
FROM headers h
JOIN cursors c ON c.chain_id = h.chain_id AND c.block_hash = h.block_hash
WHERE c.chain_id = 11155111 AND c.consumer = 'm6-indexer';

SELECT p.generation, p.indexed_through_block, p.indexed_block_hash, p.finality, p.updated_at,
       h.canonical AS header_canonical, h.finality AS header_finality
FROM m7_projection_state p
LEFT JOIN headers h
  ON h.chain_id = p.chain_id
 AND h.block_number = p.indexed_through_block
 AND h.block_hash = p.indexed_block_hash
WHERE p.chain_id = 11155111;

SELECT vault_address, wallet_address, shares, as_of_block, finality, indexed_block_hash
FROM balances
WHERE chain_id = 11155111 AND shares > 0
ORDER BY as_of_block DESC
LIMIT 20;
```

### Exact live M7 verification runbook (future; mutating phases need explicit approval)

1. Verify the approved Node runtime is `>=22` and that the compiled `dist` artifact is already built from the intended revision. Do not invoke `npm run verify:live:m7` for this closure: that npm script rebuilds first. With matching prebuilt artifacts and an approved production environment (`NODE_ENV=production`, configured by the approved runtime, never by printing secrets), the verifier entry point is `node scripts/verify-m7-live.mjs`; it is read-only and must return exit 0 with `"status":"PASS"`.
2. Confirm the target factory address, chain `11155111`, migration ledger, named contract owner, signer authority, wallet funding, and rollback/operational approvals. Migration `0004` is already present in the provided schema evidence; do not rerun it.
3. If no approved sample exists and the factory still reports `vaultCount=0`, an authorized Sepolia signer must call the deployed factory's `createVault(config, name, symbol)` using a reviewed `VaultConfig`: `poolKey` (`currency0`, `currency1`, `fee`, `tickSpacing`, `hooks`), supported `strategy` and `shapeId`, `centerTick`, `ticksLeft`, `ticksRight`, `driftTicks`, `trailTicks`, `autoRebalance`, `lockOnFill`, `depositCap`, and `baseIsCurrency0`. Values must match the deployed pool, configured strategy contracts, token ordering and contract constraints. This sends a Sepolia transaction and is expressly outside this QA authorization. Record the successful receipt, `VaultCreated` event, vault address, transaction hash and creation block; re-read `vaultCount` and verify the event/address with read-only calls.
4. To create a positive holder sample, an authorized funded holder must satisfy the vault token requirements/allowances and call the deployed vault's `depositPair(amount0, amount1, minShares, receiver)` (or the approved supported deposit method). This is a second Sepolia transaction and is also outside this QA authorization. Verify its successful receipt and a mint `Transfer` from the zero address to the intended receiver with positive shares; record the holder, transaction and block.
5. After separate approval, run exactly one indexer worker from the verified deployment start block with the correct chain, PostgreSQL, Redis, worker ID, confirmations and reorg limit. Do not use this QA task to start it. Let it ingest both canonical events and catch up to a finalized block at or beyond them.
6. Repeat the read-only preflight above. Confirm the vault and positive holder are projected, cursor/projection hashes are canonical and equal to the expected pinned block, projection finality is `FINALIZED`, and `shares > 0`.
7. With matching prebuilt `dist` and production environment configuration, run `node scripts/verify-m7-live.mjs`. Preserve its JSON and exit status without exposing environment values. Its pinned VaultLens reads must agree with the projected vault and every shares-positive holder at the same finalized snapshot. Release evidence requires `"status":"PASS"` and empty `blockers`; a `BLOCKED` result is not a pass.

### Node.js 22+ verification

The package requires `node >=22`. The previous QA record observed Node `v20.20.2`; no fresh runtime probe could be performed in this closure. On the approved Windows build host, upgrade with the organization's approved installer/version manager (if `nvm-windows` is already installed: `nvm install 22`, then `nvm use 22`), open a new terminal, and run `node --version` (must report `v22.x` or later), `npm --version`, and `npm pkg get engines.node` (must report `>=22`). Do not rebuild or rerun M0-M7 as part of this closure; archive the existing evidence and schedule any Node-22 build/test verification separately with approval.

### Isolated PostgreSQL/Redis test safety

The repository's `scripts/verify-m4-m5-live.mjs` creates and drops a random PostgreSQL schema, applies migrations and test rows, and creates/expires/deletes Redis keys including the real chain-scoped indexer lease key. Random names do not make a shared production endpoint safe. Run it only after the configured PostgreSQL and Redis endpoints are separately provisioned disposable instances, their ownership/network identity has been confirmed without exposing URLs, and no Railway production/shared endpoint is in use. Prefer disposable local containers or an approved isolated staging project. Never point it at Railway production; never infer isolation from a schema prefix or Redis namespace. This closure did not execute it.

## I. Final decision

| Decision area | Verdict |
| --- | --- |
| Local M0-M7 functional implementation | PASS in the previously recorded Node 20 run |
| Required Node 22 release runtime | NOT VERIFIED; previous recorded runtime was Node 20.20.2 |
| Current isolated PostgreSQL/Redis integration evidence | NOT RUN; safely possible only against independently proven disposable targets |
| Synthetic blockchain/indexer/M7 reconciliation | PASS |
| Real Sepolia M3 contract gate | PASS read-only |
| Real Sepolia M6 bounded verification | PASS read-only, operational coverage PARTIAL |
| Official M7 live exit gate | BLOCKED |
| Next operational stage (worker start, factory/holder transactions, deploy or production release) | **NO-GO** |
| Documentation/read-only preparation | **GO** |
| Production release | **BLOCKED / NOT READY** |

The correct overall milestone status is **PARTIAL**. No claim of 100% completion or live M7 PASS is supported by the current evidence.
