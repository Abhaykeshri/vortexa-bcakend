# M0-M5 security review

Date: 2026-11-02. Scope is the backend M0-M5 foundation; it is not an independent audit.

## Controls verified

- Non-custodial boundary: no private-key input, signer construction, send-transaction RPC method or broadcast endpoint. RPC allowlisting rejects unsafe methods.
- HTTP policy: minimal public liveness; constant-time Bearer-key validation for readiness and wiring; exact CORS allowlists for browser routes; strict Redis-backed fixed-window limits for network, chain and contract status. Browser `Origin` is never accepted as authentication, and internal routes reject browser-origin requests.
- Production configuration fails startup when Redis, the exact HTTPS production-origin list, or a strong internal key is missing. Rate-limited reads fail closed if Redis becomes unavailable while liveness remains independent for Railway recovery probes.
- Secrets: `.env` is ignored; `.env.example` now contains placeholders; logs do not print connection strings; CI scans common private-key and credential URL forms. Previously exposed Railway credentials must be rotated by the operator.
- Chain integrity: startup requires all 12 environment addresses, selects a versioned address-free Sepolia hash manifest, validates chain 11155111 and gates readiness on 12 runtime hashes.
- ABI/source/wiring: local ABIs and immutable-masked deployed runtime exactly matched all 12 Solidity artifacts; finalized-block reads and 15 wiring relations passed live.
- Amount safety: EVM values remain bigint/canonical decimal strings and PostgreSQL uses `numeric(78,0)`.
- Database: parameterized statements, constraints, unique idempotency keys, atomic transactions and rollback; no shared rows were overwritten.
- Redis: namespaced keys, bounded TTLs, NX acquisition and compare-owner renew/release. Cache failure becomes a miss; coordination/authorization failure does not grant access.
- HTTP: origin allowlist behavior, no-store/CSP/frame/content-type/referrer headers, method denial, timeout and redacted upstream errors are present.

## Findings

1. High operational: credential-like values were committed in `.env.example`. Fixed in this session; rotation remains mandatory because removal does not invalidate exposed credentials.
2. Medium assurance: no backend Git repository/history exists, preventing provenance, reviewed-commit and clean-clone evidence.
3. Medium M4: backup/PITR restore and approved production migration are unverified.
4. Medium M5: no managed Redis restart/worker retry/dead-letter end-to-end drill; M6 worker/indexer is not yet implemented.
5. Informational API: no mutation payload exists in M0-M5; SIWE, CSRF and mutation rate middleware belong to M8. The current read API enforces headers, CORS allowlisting, method denial and upstream redaction.

Contract and PostgreSQL state are authoritative; Redis is never authoritative. Environment variables supply deployment addresses, while the selected manifest independently pins expected runtime hashes. Unsupported contract features fail closed. Any future signer must remain outside the public API and is not authorized by this work.
