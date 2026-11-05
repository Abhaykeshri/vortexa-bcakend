# V2 indexer catch-up and reconciliation plan

No live backfill or production mutation was executed while implementing the V2 UI APIs.

## Current incompatibility to resolve

The configured projection checkpoint predates the current deployment. The current contract set begins at block `12060410`, the current factory at `12060681`, while the last inspected projection head was `12033742`. Existing raw logs include a prior deployment and must not be presented as current V2 vault data.

## Approval-gated procedure

1. Stop and verify there is no active indexer lease or database writer.
2. Take a production backup and complete an isolated restore check.
3. Record current migration ledger checksums, cursor, projection generation, worker fence token, row counts, and canonical state hash.
4. Apply migration `0005_v2_ui_read_models` first to an isolated restored database. Run `npm run verify:live:infrastructure` only against that explicitly approved disposable target.
5. Create a new consumer identity for the current manifest instead of overwriting the historical consumer checkpoint. Start it at the manifest's verified earliest deployment block `12060410`.
6. Replay with the current address registry and bounded RPC ranges. The source must continue splitting provider-limited log ranges and must reject a chain mismatch.
7. Require zero unknown current-manifest events, zero canonical gaps/duplicates, and `vaultCount` parity with `VaultFactory`.
8. Reconcile every projected vault and positive holder against `VaultLens` at one finalized block.
9. Run the replay twice and require identical projection hashes and counts.
10. Exercise a synthetic reorg only in an isolated schema, then verify generation change and cache-key invalidation.
11. Promote the new consumer only after rollback owner, trigger, recovery point, and monitoring window are recorded.

## Rollback

- Stop the new consumer and release its lease.
- Restore the prior consumer configuration without modifying its cursor.
- Roll back migration `0005` only if it was applied and no V2 projection data must be preserved; the down migration is destructive and requires `ALLOW_MIGRATION_DOWN=true` plus explicit approval.
- Do not delete historical raw logs or reset the existing Railway schema in place.

## Read-only preflight commands

```powershell
npm run inspect:config
npm run inspect:operations
npm run verify:live:contracts
npm run verify:live:contract-wiring
npm run verify:production:schema
npm run verify:live:projections
```

The last two are expected to report pending V2 migration/current-vault blockers until the approved migration and first user-created vault exist.

