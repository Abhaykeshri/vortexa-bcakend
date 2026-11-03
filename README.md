# VortexA Backend - M0-M5 foundation

Implemented foundation: strict TypeScript and hexagonal boundaries; domain models/ports and fail-closed capability rules; versioned Sepolia manifest with pinned ABIs and runtime code hashes; Railway PostgreSQL Drizzle schema/migrations/repositories; Redis cache, rate-limit and lease coordination with PostgreSQL as the durable source of truth.

## Quick start (Windows PowerShell)

```powershell
Copy-Item .env.example .env
# Edit .env: enter Sepolia RPC URL; rotate Railway credentials first.
npm ci
npm run check
npm run start
```

Endpoints: `GET /health/live`, `GET /health/ready`, `GET /api/v1/network`, `GET /api/v1/chain/status`, `GET /api/v1/contracts/status`, `GET /api/v1/contracts/wiring`.

`/health/live` is a minimal public Railway-compatible liveness probe. `/health/ready` and `/api/v1/contracts/wiring` require `Authorization: Bearer <INTERNAL_API_KEY>` and reject browser `Origin` requests. Network and chain status are exact-origin, Redis-rate-limited browser routes. Contract status is browser-accessible with a stricter Redis limit. Missing or failed Redis fails those rate-limited routes closed with `503`; it does not break liveness. Never place `INTERNAL_API_KEY` in frontend code.

Contract addresses and code hashes come from `packages/contracts/manifests/sepolia-v1.json`. The environment selects the manifest; any legacy address variable must match it exactly.

Useful verification commands: `npm run verify:live:m3` performs read-only Sepolia ABI/hash/role/wiring checks. `npm run verify:live:m4-m5` creates and removes only a random isolated PostgreSQL schema and namespaced Redis keys. `npm run migrate` applies the durable schema with checksum/idempotency protection; run it only against an approved database.

## Security and scope

The public API remains **read-only** and never signs or broadcasts transactions. CORS is not authentication: exact origins are enforced for browser routes, while internal routes require a constant-time-checked server credential. `.env` is ignored and `.env.example` contains placeholders only. M6+ indexer/auth/intent/keeper work is outside this M0-M5 scope. Production readiness requires named approvals, backup/restore evidence and independent security review.

See `docs/M0_TO_M5_AUDIT.md`, `docs/M0_TO_M5_IMPLEMENTATION_REPORT.md`, `docs/M0_TO_M5_TEST_REPORT.md`, `docs/M0_TO_M5_SECURITY_REVIEW.md`, and `docs/M0_TO_M5_REMAINING_WORK.md`.
