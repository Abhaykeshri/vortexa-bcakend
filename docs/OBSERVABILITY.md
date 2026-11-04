# Observability and alerting

The API, indexer, and outbox emit single-line structured JSON. Logs must be collected with access controls and retention appropriate for operational metadata. Authorization headers, database URLs, Redis URLs, RPC provider paths, request bodies, and raw error messages must not be logged.

## Health and request telemetry

- `/health/live` proves only that the API process accepts HTTP requests.
- `/health/ready` is server-authenticated and checks Sepolia, pinned contract bytecode, PostgreSQL, and Redis.
- `http_request_completed` records request ID, method, path without query values, status code, and duration.
- Railway deployment health checks are startup gates, not continuous monitoring. Configure an independent uptime monitor for liveness and a server-side authenticated monitor for readiness.

## Required alerts

| Signal | Initial alert condition | Response |
|---|---|---|
| Public liveness | Two consecutive failures | Page API owner |
| Authenticated readiness | Any dependency unavailable for 5 minutes | Page infrastructure owner |
| HTTP 5xx | More than 2% for 5 minutes | Investigate request and upstream events |
| HTTP latency | p95 above 2 seconds for 10 minutes | Check RPC, PostgreSQL, Redis, and saturation |
| Rate-limit dependency | Any sustained `SECURITY_DEPENDENCY_UNAVAILABLE` | Restore Redis; do not bypass fail-closed behavior |
| Indexer progress | Cursor does not advance while finalized head advances for 10 minutes | Check lease, fence, RPC, and worker status |
| Reorg recovery | Any recovery-limit or canonical mismatch event | Stop release and reconcile |
| Outbox backlog | Oldest pending row exceeds 5 minutes | Check Redis publication and worker health |
| Dead letters | Any new dead-letter row | Product/operations review before replay |
| Contract identity | Any runtime hash or wiring mismatch | Block release and privileged operations |

Tune thresholds after collecting a stable baseline. Every alert must have an owner, severity, notification route, and linked recovery runbook.

`npm run inspect:operations` produces a read-only JSON snapshot of indexer cursors/workers, projection state, and outbox backlog/dead letters. Run it only from an approved operator context with read access; it never prints connection credentials or stored payloads.

## Release dashboard

Display API request rate/error/latency, dependency readiness, Redis errors, PostgreSQL pool saturation, RPC failures by operation, latest/finalized/indexed blocks, indexer lag and batch size, reorg count/depth, outbox pending/oldest/dead-letter counts, deployed revision, and manifest version.

