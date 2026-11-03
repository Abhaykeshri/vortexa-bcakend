# M6 implementation report

Updated: 2026-11-03.

The M6 worker remains Sepolia-only and chain-aware. This update adds unique per-process Redis lease owners and a monotonic PostgreSQL fencing token. Batch commits, reorg rollback and finality promotion lock and validate the fencing row inside the same transaction before changing indexed state. A stale worker therefore cannot commit after a newer worker has acquired a higher fence.

The replay command now verifies the configured RPC chain before opening its database connection or writing replay rows. `eth_getLogs` range splitting handles recognized range-limit responses, including JSON-RPC `-32602`/`InvalidParamsRpcError`; ordinary failures at one block propagate into the worker's capped exponential retry. Safe operation/range/code diagnostics were added without raw provider detail.

Migration `0003_m5_outbox_m6_fencing` adds the fencing counter to `indexer_worker_state` and outbox claim-owner/expiry fields. It was applied to the user-confirmed isolated staging database after checksum/schema/session/lease preflight; it has not been applied to production.

Worker shutdown now writes fenced `STOPPED` status after SIGTERM/SIGINT and `DEGRADED` after a fatal exit; a stale fence cannot update the newer owner's status. Staging restart/resume passed: cursor `12054248` advanced to `12054415` after SIGTERM, then to `12054421` after restart/SIGINT. Both runs exited 0.

The reorg verifier now freezes one RPC head snapshot for catch-up, synthetic fork, and canonical recovery assertions. Staging verification passed at head `12054425`, fork ancestor `12054423`, with exactly two journal entries and successful reconciliation (0 gaps/duplicates). Final cleanup confirmed cursor hash matched RPC, status STOPPED, no active worker session, and no Redis lease.

The earlier `InvalidParamsRpcError` did not include operation/range/code telemetry and was not reproduced in the bounded staging run. `eth_getLogs` now treats `-32602`/`InvalidParamsRpcError` as a possible provider range-limit rejection and bisects only that address-scoped range; a failure at one block propagates into the existing capped exponential retry. The worker now logs operation, block range, RPC code and cause type without raw upstream detail. A 500-block read-only Sepolia logs probe passed. The precise historical provider response remains **NOT REPRODUCED** and needs monitoring during any future approved indexing.

This was bounded current-cursor catch-up, not a full historical backfill. Deeper reorg recovery, managed Redis failover, abrupt process-loss status recovery, and production gates remain open.

Verdict: **BOUNDED STAGING CHECKS PASS; RPC OBSERVATION AND FULL OPERATIONAL/PRODUCTION GATES REMAIN**.
