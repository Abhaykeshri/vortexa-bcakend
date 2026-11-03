# M0–M6 test report

Date: 2026-11-03. Results below distinguish local/mocked, live read-only Sepolia, and isolated managed-service checks.

## Executed evidence

| Command | Scope | Result |
|---|---|---|
| `npm run typecheck` | Strict TypeScript | PASS |
| targeted Node tests | Chain registry, config, security | PASS |
| `npm run verify:live:m3` | Read-only Sepolia ID, 12 ENV addresses/hashes, ABI reads, roles and wiring | PASS — 56/56 at finalized block 12053183 |
| `npm run verify:live:artifacts` | Local compiled Solidity ABI and normalized runtime equivalence | PASS — 12/12 |
| `npm run verify:live:m4-m5` | Random isolated PG schema and namespaced Redis keys | PASS — migration repeat/CRUD/constraints/concurrency/rollback and value/TTL/lease/takeover/reconnect |
| `npm run check` | Secret scan, boundaries, lint, format, typecheck, build, complete test suite | PASS — 40/40 automated tests |
| local HTTP smoke | Liveness, unsupported-chain response, SIGINT shutdown | PASS — `ok`, HTTP 400, graceful dependency close |

The M4/M5 verifier cleans only its random schema and namespaced keys. It did not change the production `public` schema or flush Redis. The M3 verifier uses allowlisted reads and does not hold a signer.

## Required behavior covered

- Valid Sepolia configuration and disabled future network rejection.
- Malformed/unsupported chain rejection, wrong RPC chain rejection, and missing deployment rejection.
- RPC timeout/retry/fallback and unsafe RPC method denial.
- Chain-scoped cache/job identifier separation and chain-aware PostgreSQL keys.
- Exact CORS, internal bearer key, browser/internal route separation, rate limits, and fail-closed Redis behavior.
- Domain validation, stale adapter data, capability denial, repositories, transaction rollback, concurrent writes, outbox idempotency/retry/dead-letter, lease ownership and TTL.
- Bytecode, ABI, ownership, critical wiring, timelock delay, and vault pause state on Sepolia.

## Not tested or not claimable

- M6 acceptance criteria: specification missing.
- Production Railway deployment or post-deploy smoke test.
- Production backup/restore and production migration.
- Managed production Redis restart with a running worker.
- Credential rotation and real production frontend CORS origin.
- Blockchain transaction simulation/submission/receipt lifecycle: no implemented endpoint and no broadcast authorization.

## Final verification

Final `npm run check`: secret scan passed over 77 files; domain boundaries passed; ESLint passed with zero warnings; Prettier check passed; TypeScript/build passed; 40/40 tests passed. This result must be read together with the final Git diff and is not production approval. Historical 33/33 and 56/56 statements are not reused as evidence; the 56/56 result above was executed during this pass.
