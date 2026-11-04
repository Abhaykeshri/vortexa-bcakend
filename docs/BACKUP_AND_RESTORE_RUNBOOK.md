# PostgreSQL backup and restore runbook

This procedure is approval-controlled. Never restore over the source database, and never run migration rollback as an automated deployment hook.

## Required evidence before starting

- Approved source environment and database owner
- Revision, deployment manifest version, and migration ledger snapshot
- Recovery-point objective and acceptable maintenance window
- Destination database that is isolated from production
- Named backup, restore, validation, and rollback owners

Prefer a Railway managed backup or point-in-time recovery point. When a logical backup is required, use supported `pg_dump` and `pg_restore` versions at least as new as the server. Supply credentials through an operator-managed password file or secret injection; do not paste connection URLs into shell history, logs, tickets, or command output.

## Backup

1. Pause the indexer and outbox through the approved service control. Keep the API read-only.
2. Confirm no active migration session and record current cursor, outbox backlog, and table counts.
3. Create a custom-format backup:

   ```text
   pg_dump --format=custom --no-owner --no-acl --file=<protected-backup-path> <approved-source-service>
   ```

4. Generate SHA-256 and record the backup size, start/end time, PostgreSQL version, source identifier, and retention expiry.
5. Resume services only if the maintenance plan explicitly permits it.

## Isolated restore rehearsal

1. Provision a new empty PostgreSQL target with no production consumers.
2. Restore with ownership mapped to the isolated application role:

   ```text
   pg_restore --exit-on-error --no-owner --no-acl --dbname=<isolated-target-service> <protected-backup-path>
   ```

3. Point a local operator shell at the isolated target and run:

   ```text
   npm run verify:production:schema
   npm run migrate
   npm run verify:production:schema
   npm run indexer:reconcile
   ```

4. Compare migration checksums, table counts, cursor-to-header linkage, canonical log uniqueness, projection state, unprocessed outbox rows, and dead-letter rows with the source snapshot.
5. Start an isolated API against the restored target and run the authenticated smoke suite.
6. Record restore duration, integrity results, data-loss window, and approver. Destroy the isolated target only under its environment cleanup policy.

## Failure handling

- A checksum mismatch blocks the release; never edit an applied migration.
- A failed restore must preserve its logs and backup artifact for diagnosis.
- If application and database revisions are incompatible, redeploy the prior application artifact first. Database rollback or restore requires a separate approval and recovery point.

