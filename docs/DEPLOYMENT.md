# PM2 deployment runbook (Raj Sir)

This is a template for the M0-M5 **read-only API foundation**, not a production approval. No Docker required.

1. Install Node.js 22 LTS, npm and PM2 on the target server.
2. Clone the repository, `npm ci` (when lockfile exists), then `npm run check`.
3. Copy `.env.example` to `.env` and set real secrets **only on the server**. Set a random `INTERNAL_API_KEY` (minimum 32 characters), exact HTTPS `CORS_ALLOWED_ORIGINS_PRODUCTION`, Redis limits and `HOST=127.0.0.1` behind Nginx. Never ship the internal key to a browser.
4. Configure Sepolia HTTPS RPC, Railway **public** PostgreSQL/Redis URLs, and the 12 contract addresses.
5. Run `npm run build`, then `pm2 start ecosystem.config.cjs --env production`.
6. Configure Railway's health-check path as `GET /health/live`; it needs no API key and returns only `{ "status": "ok" }`. Verify readiness server-to-server with `Authorization: Bearer <INTERNAL_API_KEY>`. Do not put the key in shell history; inject it through the operator's secret mechanism.
7. Put Nginx HTTPS reverse proxy in front; restrict internal endpoints at the network layer too, apply request limits, and monitor `401`, `403`, `429`, and Redis-driven `503` responses. Set `TRUST_PROXY=true` only when every request reaches the API through the trusted proxy.
8. Deploy updates with `git pull`, `npm ci`, `npm run check`, `pm2 reload ecosystem.config.cjs --env production`.
9. Run `npm run migrate` only after an approved backup and staging rehearsal. Do not use `migrate:down` in production without separate destructive-change approval.
10. Roll back application code by checking out the previously approved git tag and rebuilding/reloading; database rollback follows the reviewed migration plan.

**Security:** the API exposes only GET read endpoints and never private keys, signed transactions, or blockchain writes. `/health/ready` and contract wiring are internal-key routes. Network, chain and contract status use Redis-backed limits and fail closed on Redis failure. Do not expose port 3000 directly. PostgreSQL is durable; Redis is ephemeral and must never become the authority for jobs or authorization.
