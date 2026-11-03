# M0-M5 remaining work and blockers

## Approval and ownership

- Assign and record the backend owner, contract lead, security reviewer, operator and release authority; approve the M0 scope/threat model/role matrix.
- Initialize or restore the backend Git repository and establish reviewed commit/PR evidence. No commit/push was performed.
- Obtain contract-lead/release-authority signature for `sepolia-v1-2026-11-02`; technical ABI and normalized deployed-bytecode equivalence is already 12/12 PASS.

## M1-M3

- Re-run `npm ci && npm run check` from a clean Git checkout after repository provenance is restored. Node 22.23.4 verification already passes locally.

## M4

- Before an approved migration: rotate exposed credentials, take/verify a Railway backup, review the schema, and run `npm run migrate` against staging.
- Rehearse PITR/restore in an operator-approved staging database and record RPO/RTO. Repeat migration, constraints, concurrent idempotency and rollback already pass in an isolated Railway schema.

## M5

- In a disposable Redis/staging instance, perform a managed service restart and notification-loss drill. Reconnect, expired lease takeover, duplicate prevention and durable retry/dead-letter behavior are already tested.
- M6 must connect reorg detection to cache invalidation; that behavior cannot exist before the indexer milestone.

## Beyond M5

M6-M19 are specified in the client guide but outside this execution request. SIWE/API auth is M8, unsigned wallet intents are M10, keeper shadow mode is M12, and any privileged signer/broadcast is M13 and remains disabled pending explicit approval.

The M0-M5 code foundation is usable for continued development, but release readiness is blocked by approvals, Git provenance, staging migration/restore evidence, independent security review and resilience drills. No production deployment or shared-schema mutation was performed.
