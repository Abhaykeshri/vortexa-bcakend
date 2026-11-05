# VortexA Backend — Live Integration Verification

Verification date: 2026-11-05. This report uses the existing Railway services and Sepolia read-only RPC. No migration, backfill, deployment, signing, broadcast, or destructive operation was performed.

## Verdict

| Area | Status | Evidence |
| --- | --- | --- |
| Infrastructure readiness | PASS | Railway PostgreSQL connection and Redis `PING` succeeded. |
| API readiness | PARTIAL | Express started; `/health/live` and `/health/ready` returned 200. Listing fails closed at 503 because migration 0005 is unapplied. |
| Vault Listing | BLOCKED | Factory vault count is 0 and V2 read-model tables are not present. |
| Create Vault | PASS | Config validation and unsigned create simulation returned 200. |
| Deposit | BLOCKED | No registered Sepolia vault; quote and builder returned semantic 404. |
| Withdraw | BLOCKED | No registered vault/position; quote and builder returned semantic 404. |
| Database readiness | PARTIAL | PostgreSQL reachable; ledger contains 0001–0004 only; 0005 intentionally unapplied. |
| Indexer readiness | PARTIAL | Cursor is finalized through block 12033742; worker is stopped; no V2 projection tables. |
| Frontend integration readiness | BLOCKED | Frontend can integrate DTOs, but live listing/deposit/withdraw data requires migration plus an indexed vault. |
| Production deployment readiness | BLOCKED | Operator must approve migration/backfill and deployment separately. |

## Infrastructure

- PostgreSQL: PASS. Database `railway`, PostgreSQL 18.6, authenticated successfully.
- Redis: PASS. Authenticated `PING` returned `PONG`.
- Express: PASS. `GET /health/live` returned 200.
- Readiness: PASS. `GET /health/ready` returned 200 with `sepolia`, `postgres`, `redis`, and `contracts` all `ready`.
- No credentials are included in this report.

## HTTP status matrix

Requests used browser origin `http://localhost:5173`, valid Sepolia parameters, and an unknown-but-valid vault fixture `0x0000000000000000000000000000000000000001`.

| Method | Endpoint | Status | Result |
| --- | --- | ---: | --- |
| GET | `/v1/openapi.json` | 200 | PASS |
| GET | `/v1/chains/11155111/vaults` | 503 | BLOCKED: migration 0005/read model unavailable; fail-closed |
| GET | `/v1/chains/11155111/vaults/:vault` | 404 | PASS: unknown vault |
| GET | `/v1/chains/11155111/vaults/:vault/bands` | 404 | PASS: unknown vault |
| GET | `/v1/chains/11155111/vaults/:vault/activity` | 404 | PASS: unknown vault |
| GET | `/v1/chains/11155111/vaults/:vault/history` | 404 | PASS: unknown vault |
| GET | `/v1/chains/11155111/vaults/:vault/rebalances` | 404 | PASS: unknown vault |
| GET | `/v1/chains/11155111/users/:address/positions` | 200 | PASS: empty page |
| GET | `/v1/chains/11155111/pools` | 200 | PASS: live PriceGuard/pool reads |
| GET | `/v1/shapes` | 200 | PASS |
| POST | `/v1/shapes/preview` | 200 | PASS |
| GET | `/v1/chains/11155111/limits` | 200 | PASS |
| POST | `/v1/chains/11155111/tx/validate-config` | 200 | PASS |
| POST | `/v1/chains/11155111/tx/create-vault` | 200 | PASS: unsigned simulated plan |
| POST | `/v1/chains/11155111/quotes/deposit` | 404 | BLOCKED: no registered vault |
| POST | `/v1/chains/11155111/tx/deposit` | 404 | BLOCKED: no registered vault |
| POST | `/v1/chains/11155111/quotes/withdraw` | 404 | BLOCKED: no registered vault |
| POST | `/v1/chains/11155111/tx/withdraw` | 404 | BLOCKED: no registered vault |
| POST | `/v1/chains/11155111/tx/manager/update` | 404 | BLOCKED: no registered vault |
| POST | `/v1/chains/11155111/tx/manager/rebalance` | 400 | PASS validation: malformed/incomplete fixture rejected |

Transaction responses were inspected for unsigned calldata behavior; no signature or broadcast transaction hash was produced.

## Sepolia verification

Chain ID is `11155111`. `verify:live:contract-wiring` passed **59/59** checks at finalized block `12067903`, including bytecode hashes, ABI reads, PriceGuard, ShapeLibrary, factory wiring, Zap wiring, ownership alignment and timelock delay. Factory `vaultCount` is `0`.

## Database and indexer

- Public table count: 19 existing tables.
- Migration ledger: `0001_m0_m5_foundation`, `0002_m6_indexer`, `0003_m5_outbox_m6_fencing`, `0004_m7_vault_catalog`.
- Migration `0005_v2_ui_read_models`: **NOT APPLIED**, as required.
- Indexed vault rows: 0.
- Current cursor: consumer `m6-indexer`, finalized block `12033742`.
- Worker state: `m6-indexer` is `STOPPED`; last success was recorded without an error.
- Live projection verifier: `BLOCKED`, factory sample unavailable and V2 projection read model absent.

Safe operator sequence after separate approval:

```powershell
npm run verify:production:schema
npm run migrate
npm run verify:live:indexer
npm run verify:live:projections
```

Do not run this sequence against production without migration and backfill approval. The first command is read-only; the remaining commands require explicit operational approval.

## Quality and security

- Typecheck: PASS
- Build: PASS
- Tests: PASS, 98/98
- Lint: PASS
- Production dependency audit: PASS, 0 vulnerabilities
- Security middleware tests: PASS (CORS, Helmet, payload limits, CSRF policy, distributed rate limiting)
- No private keys exposed; no signing/broadcast code path used.
- No fabricated analytics are returned; unavailable metrics remain null with availability metadata.

## Remaining actions

1. Approve and apply migration 0005 in a controlled window.
2. Start/reconcile the indexer from the verified deployment/current cursor and verify reorg-safe V2 projectors.
3. Create or identify at least one real Sepolia vault and position; rerun deposit/withdraw quote and unsigned-builder tests.
4. Re-run this report's HTTP matrix and provide the resulting live vault IDs to the frontend team.

