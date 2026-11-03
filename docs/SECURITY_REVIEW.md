# Security review

Date: 2026-11-03. Scope: backend source/configuration and read-only deployment verification. This is an engineering review, not independent audit or release approval.

## Controls confirmed

- The service has no signer and JSON-RPC denies non-allowlisted methods, including transaction broadcast.
- Only Sepolia may be active; RPC chain mismatch, unsupported chain, missing deployment, and wrong manifest chain fail closed.
- Internal routes use a bearer key whose SHA-256 digest is constant-time compared. Internal routes reject browser origins.
- Browser routes use exact CORS origins and Redis-backed limits. Origin is never treated as identity; Redis loss fails protected public routes closed.
- Defensive headers and `no-store` are applied; API errors do not expose exception/provider/credential detail.
- Production requires PostgreSQL, Redis, HTTPS origins, and a 32+ character internal key. Local env files are not loaded in production.
- `.env` is ignored; example values are placeholders; secret scanning covers tracked source.
- SQL is parameterized; migrations are advisory-locked/checksummed/transactional; chain-aware keys prevent cross-chain record overwrite.
- Redis leases compare owner tokens for renew/release; TTLs are bounded; PostgreSQL remains durable.

## Threat and risk register

| Threat | Control | Residual risk / action |
|---|---|---|
| Wrong-chain RPC/provider compromise | `eth_chainId`, pinned runtime hashes, multiple independent checks | RPC can censor/stale reads; monitor providers and block age |
| Missing/malicious deployment | Required ENV addresses plus manifest runtime hashes and wiring/role verification | Environment and manifest approval remain operational controls |
| Cross-chain collision | Chain-aware DB keys and scoped cache/job key helper | Future producers must use helper and chain-scoped outbox keys |
| API key theft | Server-only storage, digest/constant-time comparison, no browser origin | Add rotation/runbook and secrets manager evidence |
| Browser abuse | Exact CORS and Redis rate limiting | CORS is not auth; public data remains public |
| Redis outage | Fail-closed rate limits; cache degrades; PG durable | Production restart drill pending |
| Database loss/corruption | Transactions, constraints, rollback, backup plan | Production backup/restore proof pending |
| Reorg/stale indexed state | Header/log/cursor schema and confirmation depth | Backend M6 reorg/indexer spec missing; no indexer claim |
| Transaction/key compromise | No signer or broadcast path | Preserve boundary until an approved later milestone |
| Sensitive error/log leakage | Coarse responses and no secret serialization | Central log redaction/production log review pending |

## Authorization matrix

| Route group | Anonymous server client | Approved browser origin | Internal bearer |
|---|---:|---:|---:|
| Liveness | Yes | No | Not needed |
| Network/chain/contracts status | Yes, rate-limited | Yes, exact CORS and rate-limited | Not needed |
| Readiness/wiring | No | No | Yes |
| Mutation/sign/broadcast | No route exists | No route exists | No route exists |

## Open findings

High: none found in the implemented read-only scope. Medium: missing authoritative M6 reorg/indexer requirements; no production backup/restore or Redis recovery evidence; production credentials/origin/deployment unverified. Governance: independent security, ownership, operations, and release sign-offs are pending and were not self-approved.
