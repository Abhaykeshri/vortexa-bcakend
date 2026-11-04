# Railway deployment guide

## Service topology

| Service | Start command | Exposure | Replicas |
|---|---|---|---|
| `vortexa-api` | `npm run start` | Public HTTPS | One until scaling approval |
| `vortexa-indexer` | `npm run indexer:start` | Private worker | Exactly one active writer |
| `vortexa-outbox` | `npm run outbox:start` | Private worker | One until concurrency review |

All services build with `npm run build` on Node.js 22. The API startup health path is `/health/live`; authenticated `/health/ready` must be monitored separately because Railway deployment health checks are not continuous monitoring.

## Release procedure

1. Select an immutable revision and pass clean-install CI with `npm ci --no-audit --no-fund` and `npm run ci`.
2. Pass static release validation, runtime bytecode verification, contract wiring verification, and the read-only timelock inspection.
3. Rotate approved credentials, configure exact frontend origin, and review `TRUST_PROXY` ingress assumptions.
4. Create a PostgreSQL recovery point and complete an isolated restore rehearsal.
5. Run the read-only production schema check, review pending migration SQL/checksums, approve the exact target, and execute migrations as a separate operator action.
6. Generate and review the Railway IaC plan. The plan must not include destructive database, volume, domain, or unrelated service changes.
7. Deploy the API revision. Verify liveness, authenticated readiness, structured request logging, and `npm run smoke:production`.
8. Start the indexer, verify lease/fence ownership and bounded progress, then start the outbox and verify backlog processing.
9. Observe the release dashboard through the stabilization window and obtain named release approval.

## Rollback

Redeploy the prior immutable application artifact first. Never attach `migrate:down` to a Railway deployment hook. If schema incompatibility prevents application rollback, follow the database decision process in [ROLLBACK_RUNBOOK.md](./ROLLBACK_RUNBOOK.md) using a verified recovery point.

## Evidence

Record revision, IaC plan, Railway deployment IDs, service variables owner, backup/restore evidence, migration ledger, health/smoke output, contract/timelock verification, worker cursor/fence/backlog observations, alerts, and named approvals.
