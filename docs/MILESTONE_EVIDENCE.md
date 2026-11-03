# Milestone verification checklist

- M0: authoritative M0-M5 requirements and gaps are recorded in `M0_TO_M5_AUDIT.md`; named approvals remain open.
- M1: strict TypeScript, boundary/secret checks, CI and PM2 template are present; lint/format and Git clean-clone evidence remain open.
- M2: typed models/ports/mocks and fail-closed domain tests are present.
- M3: versioned 12-contract Sepolia manifest, exact ABIs, runtime hashes, provider failover, finalized-block reads and live role/wiring checks are present.
- M4: Drizzle schema, checksummed migrations, parameterized repositories and isolated Railway CRUD/rollback verification are present; staging migration/restore remains open.
- M5: durable PostgreSQL outbox/jobs and ephemeral Redis cache/rate/lease/notification adapters are present; restart/worker/DLQ drills remain open.
- Offline verification: `npm run check`.
- Read-only Sepolia verification: `npm run verify:live:m3`.
- Isolated Railway verification: `npm run verify:live:m4-m5`.

No result here authorizes deployment, blockchain broadcast, shared-schema migration, credential change or release.
