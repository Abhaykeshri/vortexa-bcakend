# M0–M6 implementation report

Date: 2026-11-03. Scope: repository `vortexa-bcakend` plus read-only comparison with the local Solidity repository. No production deployment, shared-schema migration, credential rotation, Redis flush/restart, contract change, or transaction broadcast was performed.

## Milestone summary

| Milestone | Implementation | Tests | Documentation | Status |
|---|---|---|---|---|
| M0 | Architecture, boundaries, environment policy, risks and gates | Boundary, secret and configuration checks | This report, security review, readiness checklist | PARTIAL — external approvals open |
| M1 | Node 22 strict TypeScript API, configuration, errors, headers, CI, Railway binding | Typecheck, lint, format, build, API security | README and deployment guide | IMPLEMENTED / VERIFIED LOCALLY |
| M2 | Domain types, ports, validation, use cases and mocks | Domain/use-case suite | README | IMPLEMENTED / VERIFIED |
| M3 | Chain-aware registries/factory/readers, manifest, 12 ABIs, safe RPC fallback | Mocked errors, 12/12 artifacts, 56/56 live Sepolia | Multichain document | IMPLEMENTED / VERIFIED READ-ONLY |
| M4 | 14 database objects, ledger, repositories, transactions, chain-aware keys | Isolated migration, constraints, concurrency, rollback | README/readiness guide | IMPLEMENTED / ISOLATED VERIFIED |
| M5 | Redis cache/rates/leases/notifications, durable outbox/retry/DLQ | Unit and isolated TTL/lease/reconnect checks | README/readiness guide | IMPLEMENTED / ISOLATED VERIFIED |
| M6 | No authoritative backend specification found | No acceptance criteria available | Blocker recorded | BLOCKED |

## Changes in this pass

- Added `ChainRegistry`, `RpcClientFactory`, `ContractRegistry`, `ChainCapabilityRegistry`, `ChainAwareContractReader`, generic `EvmChainReadAdapter`, and chain-scoped key construction.
- Moved all 12 deployment addresses to required `CONTRACT_*` environment variables and removed every deployment address from the tracked manifest and test fixtures. The manifest now pins address-independent contract names and runtime hashes.
- Preserved `SepoliaReadAdapter` as a compatible name while removing Sepolia coupling from the underlying read adapter.
- Enforced `BLOCKCHAIN_MODE=single-chain`, `ACTIVE_CHAIN_IDS=11155111`, and `DEFAULT_CHAIN_ID=11155111`; other or disabled chain requests fail closed.
- Added optional `chainId` request validation without changing existing routes.
- Added deterministic development/test environment precedence. Production ignores local files and requires PostgreSQL, Redis, an HTTPS origin allowlist, and a strong internal key.
- Added validated logging and worker settings. The worker remains disabled by default; no transaction execution was introduced.
- Made the contract reader accept a resolved EVM chain ID while the current registry registers only Sepolia.
- Added targeted tests for disabled future chains, RPC mismatch, missing deployment, capability fallback, chain key isolation, runtime policy, and environment precedence.
- Replaced milestone/readme claims with evidence from this run.

## M6 discovery and blocker

The backend contains no authoritative M6 roadmap or acceptance criteria. Its existing documents call M6 a future indexer and state that reorg-driven invalidation is deferred. The Solidity repository's `docs/spec.md` describes contract M6 swap execution and atomic rebalance, already represented by the deployed `SwapExecutor`/vault module. That is a different repository and does not specify backend endpoints, indexing ranges, reorg policy, data projections, service-level objectives, or authorization.

Accordingly, no backend M6 feature or API was invented. Required unblock: commit or provide the approved backend M6 specification and acceptance criteria. Then map each requirement to domain, adapter, persistence, API, authorization, recovery, and test work.

## Acceptance assessment

M1–M5 implementation is complete for the currently documented scope and verified as stated. M0 cannot be complete without named approvals. M6 cannot be complete without its specification. Production gates remain open, so the overall verdict is **PARTIAL**.
