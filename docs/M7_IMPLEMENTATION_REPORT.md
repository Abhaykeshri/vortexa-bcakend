# M7 implementation report

## Outcome

M7 is implemented and passes synthetic/unit verification. It is not yet an official live PASS: the latest read-only Railway schema evidence shows migration `0004_m7_vault_catalog` is applied, but the configured factory reports zero vaults, so the required finalized vault/holder pinned-block comparison has no real sample. Prior isolated integration results are historical evidence; they were not rerun during the current QA closure.

## Implemented scope

- Factory `VaultCreated` discovery with provenance, strategy, pool, creator, transaction, and block data.
- Same-range discovery of newly created vault addresses so initialization/transfer logs in the creation transaction are not skipped.
- Idempotent vault/share/holder projections with observed, confirmed, and finalized states.
- Atomic cursor, raw-log, projection-event, projection-state, and generation updates.
- Reorg inversion for share transfers and orphan vault creation, followed by deterministic replay.
- Exact-block VaultLens/vault reads and atomic projection refresh for vault totals and holder exposure.
- Drizzle repositories behind application/domain ports; HTTP handlers contain no SQL.
- Stable list, detail, event, and wallet-position GET endpoints with decimal-string quantities.
- Generation/snapshot-scoped pagination cursors; changed projections invalidate old cursors.
- Redis response cache with the logical key shape `<route_name>:<version>:<cursor>:<limit>`, bounded TTL, and PostgreSQL fallback.
- Exact-origin CORS, API-key protection for internal routes, Redis rate limits, payload cap, JSON escaping, and defensive headers.

## Verification evidence

- Current supplied regression: 80/80 PASS; focused M7 tests: 10/10 PASS.
- Current supplied read-only checks: M3 56/56 PASS; M6 bounded verification PASS; PostgreSQL schema 19/19 tables and migrations `0001`-`0004` present; `npm audit` 0 vulnerabilities.
- Read-only live gate: `BLOCKED` because there is no factory vault or finalized positive-holder sample; migration `0004` is present.
- Current isolated PostgreSQL/Redis mutation verification was not run; see the QA report for the target-isolation requirement.

## Release gate

Do not label M7 production-ready until an authorized operator verifies a real vault and positive holder, the indexer reaches a finalized canonical block, and the read-only M7 verifier returns `PASS`. Migration `0004` is already present in the latest provided schema evidence and must not be rerun. No migration, worker start, deployment, or transaction was performed during this QA closure.
