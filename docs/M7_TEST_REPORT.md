# M7 test report

## Passed

- Supplied regression evidence: 80/80 PASS.
- Supplied focused M7 evidence: 10/10 PASS.
- Supplied read-only M3 live checks: 56/56 PASS.
- Supplied bounded M6 verification: PASS.
- Supplied PostgreSQL schema verification: 19/19 tables; migrations `0001`-`0004` applied.
- Supplied `npm audit`: 0 vulnerabilities.

## Live read-only result

The M7 live verification remains `BLOCKED`:

- `NO_FACTORY_VAULT_SAMPLE`
- No M7 projection state or finalized vault sample.
- No positive-share holder sample, so pinned holder reconciliation cannot run.

Migration `0004_m7_vault_catalog` is present in the latest read-only Railway ledger; it was not rerun. The M7 verifier is read-only. The separate `verify-m4-m5-live` integration script writes temporary schema/data and Redis keys, so it was not run against Railway; use only independently confirmed disposable PostgreSQL and Redis endpoints. No worker was started, no deployment occurred, and no Sepolia transaction was sent during this closure. See [M0_M7_COMPLETE_QA_REPORT.md](./M0_M7_COMPLETE_QA_REPORT.md) for the Node 22 check steps, startup preflight, and approved live M7 runbook.
