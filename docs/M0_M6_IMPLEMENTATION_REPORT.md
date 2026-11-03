# M0-M6 implementation report

Updated: 2026-11-03. M5/M6 code fixes were followed by isolated staging verification. Migration `0003` was applied only to the user-confirmed staging database; production data, services and credentials were not changed.

## Milestone assessment

| Milestone | Implementation and evidence | Status |
|---|---|---|
| M0 | Architecture, threat/risk notes and release gates are documented; named owners and formal approvals are external. | PARTIAL |
| M1 | Strict Node 22 TypeScript build, API security, config, lint/format and CI gates; current full-suite evidence is in `M0_M6_TEST_REPORT.md`. | PASS locally; release evidence pending |
| M2 | Domain types, ports, use cases, validation and deterministic tests. | PASS |
| M3 | Sepolia-only runtime with multichain-ready registries, 12-contract manifest/ABIs and read-only verification; latest live audit check was 56/56. | PASS read-only |
| M4 | PostgreSQL schemas, repositories, checksummed transactional migrations and prior isolated staging verification. Production backup/restore and migration were not performed. | PARTIAL operationally |
| M5 | Redis coordination, fail-closed rate limits, durable outbox and a separately runnable notification worker. Supervised staging worker recovered after a bounded local-proxy Redis connection interruption; managed Redis restart/failover remains open. | PARTIAL |
| M6 | Bounded chain indexing, atomic cursor writes, finality/reorg recovery, replay and reconciliation. Staging verified SIGTERM/SIGINT restart/resume with STOPPED status and cleanup, a fixed-head synthetic depth-2 reorg, and 0-gap/0-duplicate reconciliation. Full historical backfill and deeper reorg coverage remain open; the precise prior RPC error was not reproduced. | PARTIAL |

## Verified code-level fixes

- Outbox rows are atomically claimed in PostgreSQL with an expiring owner lease. Completion and retry/dead-letter updates require the current unexpired claim owner. The worker claims one message at a time to avoid expiring claims while queued.
- Redis publish errors now propagate to the outbox so failed notifications are retried instead of being marked processed.
- Added `apps/outbox` and `npm run outbox:start` as an independent polling worker with bounded retry delay and graceful signal handling.
- Each indexer process uses a unique Redis lease token. PostgreSQL issues a monotonic fencing token, and every indexer batch, rollback and finality update locks and validates the current token before writing.
- Replay verifies the RPC chain before opening the database or writing any indexed rows.
- `eth_getLogs` range splitting handles recognized range/response-limit errors, including JSON-RPC `-32602`/`InvalidParamsRpcError`; irreducible errors preserve capped exponential retry/backoff, with safe operation/range/code diagnostics.
- Graceful indexer SIGTERM/SIGINT writes fenced `STOPPED`; fatal errors write `DEGRADED`, and stale fencing owners cannot replace a newer worker's status.
- When `TRUST_PROXY=true`, rate limiting uses the rightmost valid `X-Forwarded-For` IP, falling back to the socket peer if the value is malformed. The trusted ingress must append/overwrite the observed peer and the service must not be directly reachable.
- Added migration `0003_m5_outbox_m6_fencing.sql` for outbox claim fields and the indexer fencing counter. Applied to the confirmed isolated staging target after checksum and schema preflight; not applied to production.

## Remaining release gates

Current-revision staging evidence is recorded in `M0_M6_TEST_REPORT.md` and `M6_TEST_REPORT.md`. The fixed-head staging reorg verifier passed without a moving-head race; indexer shutdown status and restart/resume passed for SIGTERM and SIGINT. Before production, verify managed Redis restart/failover, monitor RPC diagnostics, complete full historical backfill and deeper reorg recovery, production backup/restore and deployment smoke checks, credential-rotation confirmation, clean-checkout Node 22 CI, and named approvals.

Overall release verdict: **NOT PRODUCTION-APPROVED**.
