# M0-M5 test report

Executed 2026-11-02. No blockchain transaction was signed or broadcast. Live database/Redis verification used a random isolated namespace and removed only its own data.

| Command | Environment | Result |
|---|---|---|
| `npm run typecheck` | Local, Node 20.20.2 / TypeScript strict | PASS |
| `npm test` | Local mocked/unit/integration | PASS, 25/25 |
| `npm run verify:live:m3` | Live read-only Sepolia, finalized block 12047342 | PASS, 56/56: chain, 12 code hashes, 24 ABI reads, 15 wiring checks, ownership/delay/pause controls |
| `npm run verify:live:artifacts` | Solidity artifact ZIP + live Sepolia | PASS, 12/12 ABI and normalized deployed-runtime equivalence |
| `npm run verify:live:m4-m5` | Live Railway, isolated | PASS: PostgreSQL repeat migration/CRUD/constraints/concurrency/rollback; Redis TTL/duplicate lease/expiry takeover/reconnect |
| API smoke on port 3107 | Local API + live dependencies | PASS: `/health/live` 200; `/health/ready` 200 with four services ready; network/chain/wiring 200; POST 405; missing route 404 |
| `node scripts/check-boundaries.mjs` | Local static check | PASS |
| `npm run scan:secrets` | Local static check excluding ignored `.env` | PASS, repository scan completed |
| `npm run lint` / `npm run format:check` | Local static quality gates | PASS, zero warnings; all targeted files formatted |
| `npm audit --omit=dev` | Dependency registry | PASS, 0 vulnerabilities after upgrade to Drizzle 0.45.4 |
| Node 22.23.4 build/tests/runtime smoke | Supported runtime | PASS, 25/25 and readiness HTTP 200 |

Final consolidated command: `npm audit --omit=dev; npm run check` - PASS.

Mocked tests are not evidence of live blockchain transaction success. The M3 test is read-only. No M4 production migration or backup restore was attempted. No Redis service restart was requested against shared Railway infrastructure.

API readiness reported `sepolia`, `postgres`, `redis`, and `contracts` as ready; contract wiring returned 5/5. Node 22.23.4 build, tests and runtime smoke passed.
