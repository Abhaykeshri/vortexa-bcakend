# M0-M6 status

Updated: 2026-11-03. Migration `0003` was applied to the user-confirmed isolated staging database only. Bounded outbox/indexer worker processes were run and stopped cleanly; no production data was modified or service deployed.

| Milestone | Status | Current evidence and remaining work |
|---|---|---|
| M0 | PARTIAL | Scope, architecture and risk records exist; named owners and formal security, operations, contract and release approvals remain external. |
| M1 | PASS — Node 22 local checks | Strict build/check gates pass under Node 22. Clean-checkout CI and production deployment evidence remain pending. |
| M2 | PASS — automated tests | Domain and application regression suite passes. |
| M3 | PASS — read-only Sepolia | Re-run: 56/56 checks at finalized block 12054082; bounded M6 RPC scan decoded 10/10 logs. No transaction was submitted. |
| M4 | PARTIAL — isolated staging verified | Migration `0003` applied after checksum/schema/session/lease preflight; schema check passed 17/17 tables and 3/3 migrations. Production backup/restore and migration remain outstanding. |
| M5 | PARTIAL — bounded staging recovery passed | Supervised Linux outbox worker recovered from a brief local-proxy connection failure to staging Redis (attempts 1→2) and stopped cleanly. Managed Redis restart/failover remains unverified. |
| M6 | PARTIAL — bounded current-revision checks passed | SIGTERM/SIGINT restart/resume set status STOPPED and left no session/lease. Fixed-head depth-2 staging reorg recovered at snapshot `12054425`, wrote two journal entries, and reconciled with 0 gaps/duplicates. Full historical backfill and deeper reorgs remain NOT TESTED. `-32602` log-range splitting and capped retry/backoff are regression-tested; the historical provider error was not reproduced. |

Latest validation: Node `v22.23.4` build/typecheck, formatting, lint and **59/59 tests PASS**. Staging evidence and exact limits are recorded in `M0_M6_TEST_REPORT.md` and `M6_TEST_REPORT.md`.

## Release blockers

- Verify managed Redis restart/failover; current supervised outbox retry covered a local proxy disconnection only.
- Full historical backfill from the deployment block remains NOT TESTED; monitor the new operation/range/code telemetry during a separately bounded run before production.
- Complete deeper/longer reorg recovery tests. The bounded depth-2 staging-consumer recovery and Linux indexer SIGINT verification passed; do not attempt to induce a public-chain reorg.
- Complete production backup/restore rehearsal, managed Redis recovery, approved migration/deployment and post-deployment smoke checks.
- Confirm credential rotation and production CORS origin; obtain named contract, security, operations, data-migration and release approvals.
- Perform clean-checkout Node 22 CI from the reviewed release commit.

No production deployment, database migration, Redis restart/flush, credential rotation or blockchain transaction was performed.
