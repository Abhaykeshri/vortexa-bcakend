# M7 pinned reconciliation

`node scripts/verify-m7-live.mjs` is read-only when run with matching prebuilt `dist` artifacts and approved production configuration. The npm wrapper `npm run verify:live:m7` rebuilds first. The verifier checks the factory sample count, M7 projection schema/state, finalized projection availability, exact block hash, vault identity/config/strategy, share supply, total assets, token balances, accounting availability, and every projected holder's shares/exposure at one pinned block.

The verifier returns `PASS` only when all comparisons match. Missing schema, missing sample data, non-finalized state, RPC failure, or any mismatch produces `BLOCKED`; it never substitutes current/live reads for a pinned block.

Current evidence:

- Factory `vaultCount`: `0`.
- M7 migration `0004_m7_vault_catalog`: applied in the latest read-only Railway migration ledger.
- M7 projection state: absent; no finalized vault or positive-holder sample is available.
- Live vault parity: not executable because no real vault sample exists.
- Live holder parity: not executable because no real holder sample exists.

The verifier requires a real finalized vault and a holder with positive shares, both projected at the same canonical pinned block. Previously reported isolated test results validate implementation behavior but do not replace this live sample. For the approved runbook and read-only indexer preflight, see [M0_M7_COMPLETE_QA_REPORT.md](./M0_M7_COMPLETE_QA_REPORT.md).
