# Railway deployment guide

## Service configuration

- Runtime: Node.js 22.
- Install: `npm ci --no-audit --no-fund`.
- Build: `npm run build`.
- Start: `npm run start`.
- Set `HOST=0.0.0.0`; Railway supplies `PORT`.
- Liveness path: `/health/live`. Do not place the server-only API key in a browser or public health-check URL.

Set validated process variables from `.env.example`. Required production values include Sepolia single-chain settings, RPC URL(s), all 12 `CONTRACT_*` addresses, manifest path, Railway private `DATABASE_URL`/`REDIS_URL`, exact HTTPS frontend origins, strong internal API key, rate limits, logging, and worker settings. Local `.env` files are ignored in production.

## Release procedure

1. Pass `npm ci` and `npm run check` from a clean revision.
2. Verify `npm run verify:live:m3` and artifact equivalence.
3. Back up PostgreSQL and prove an isolated restore.
4. Validate the production schema, approve the exact target, and run `npm run migrate` once.
5. Configure Railway variables without logging their values. Use private service hostnames inside Railway.
6. Deploy the immutable revision. Keep the previous artifact available.
7. Verify `/health/live`; from a server-side operator run authenticated `/health/ready`.
8. Smoke-test network/chain/contracts endpoints with the approved origin and verify rate limits/logging.
9. Monitor error rate, RPC mismatch, database pool, Redis reconnects, outbox backlog and dead letters.
10. Obtain release approval and record evidence.

## Rollback

Application rollback should normally redeploy the prior artifact. Database rollback is destructive and requires an approved recovery point plus `ALLOW_MIGRATION_DOWN=true`; never use it as an automatic deploy hook. If health fails, stop traffic/worker work, preserve logs and state, decide application rollback versus database restore, then validate readiness again.

## Post-deploy evidence

Record revision, deployment ID/time, environment owner, migration ledger/checksum, backup/restore evidence, health responses (without credentials), smoke results, incidents, and named approvals. None of those live actions was performed by the 2026-11-03 local verification pass.
