# Release rollback runbook

Rollback is an incident decision, not an automatic database action.

## Before deployment

Record the release owner, prior immutable artifact, new artifact, deployment IDs, database recovery point, migration set and checksums, rollback trigger, maximum decision time, communication channel, and approvers.

## Triggers

- Liveness or readiness remains unhealthy after the agreed stabilization window
- Contract hash, wiring, chain ID, or projection parity mismatch
- Sustained elevated 5xx or latency
- Indexer fence loss, unrecoverable reorg, or corrupted cursor linkage
- Material outbox duplication or dead-letter growth
- Confirmed security-control regression

## Application rollback

1. Stop rollout and mutation workers; preserve logs and current state.
2. Redeploy the previously approved immutable application artifact.
3. Do not run migration-down automatically.
4. Verify liveness, authenticated readiness, schema compatibility, contract wiring, and production smoke checks.
5. Resume indexer/outbox one at a time after cursor, fence, lease, and backlog review.

## Database decision

If the prior artifact cannot read the current schema, choose one of these under database-owner approval:

- Deploy a forward-compatible application fix.
- Restore the verified pre-release recovery point into a new database and switch the approved secret.
- Run a reviewed down migration only when its data loss is understood, a recovery point exists, and `ALLOW_MIGRATION_DOWN=true` is set for that single operator session.

Never overwrite the original database during diagnosis. Validate counts, constraints, cursor/header linkage, projections, and outbox state before restoring traffic.

## Closure evidence

Trigger, decision maker, commands/actions, artifact IDs, database decision, validation output, user impact, data-loss assessment, follow-up owner, and incident approval.

