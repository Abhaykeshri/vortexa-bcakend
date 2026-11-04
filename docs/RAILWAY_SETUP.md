# Railway service setup

The repository defines `vortexa-api`, `vortexa-indexer`, and `vortexa-outbox` in `.railway/railway.ts` using Railway Infrastructure as Code. The file is safe to plan locally but must not be applied without reviewing the linked project, environment, cost, variables, and resulting diff.

## Planning

1. Install an approved Railway CLI release compatible with the `railway` SDK in `package-lock.json`.
2. Authenticate and link the intended non-production project/environment.
3. Run the Railway configuration validation and plan commands.
4. Confirm the plan affects only the three intended services and does not delete or replace databases, volumes, domains, or unrelated services.
5. Apply only after named infrastructure approval.

Railway's legacy `railway.toml`/`railway.json` config-as-code format is deprecated, so this repository uses the current TypeScript IaC format.

## Networking and variables

- Use Railway private PostgreSQL and Redis references for deployed services.
- Do not enable public database/Redis TCP proxies for normal production operation.
- Keep RPC URLs, database/Redis URLs, CORS origins, internal API keys, and worker identities in Railway variables or a managed secret store.
- Set an exact HTTPS `CORS_ALLOWED_ORIGINS` value.
- Enable `TRUST_PROXY` only after confirming the Railway ingress supplies the observed client as the rightmost forwarded address and the service cannot be bypassed directly.
- The API listens on Railway's injected `PORT` with `HOST=0.0.0.0`.

The deployment plan deliberately contains no pre-deploy migration hook. Backup, restore rehearsal, schema review, and an explicit migration approval must happen before an operator runs `npm run migrate`.
