# Multichain-ready architecture

## Runtime policy

The architecture is chain-aware; the runtime is not multichain-enabled. Only Ethereum Sepolia (`11155111`) is registered and enabled. Configuration rejects any other active/default chain and `ChainRegistry.resolve` rejects absent or disabled networks. No fallback crosses chain boundaries.

## Components

| Component | Responsibility |
|---|---|
| `ChainConfig` | Chain identity, enabled state, RPC set, finality depth, manifest and capabilities |
| `ChainRegistry` | Unique registration, active/default resolution, disabled/unsupported rejection |
| `RpcClientFactory` | Builds read-only transport(s) for a resolved chain |
| `EvmChainReadAdapter` | Verifies RPC-reported chain ID and exposes safe block/code reads |
| `ContractRegistry` | Resolves a deployment address by chain and contract key; missing is an error |
| `ChainCapabilityRegistry` | Resolves proven features; absent features are `UNSUPPORTED` |
| `ChainAwareContractReader` | Creates a viem reader from resolved chain RPC configuration |
| `chainScopedKey` | Constructs collision-resistant chain-specific cache/job identifiers |

Deployment manifests bind chain ID, version, contract names, and runtime hashes. Deployment addresses are required environment variables and are never stored in the manifest or application source. Production readiness verifies every ENV-selected deployment rather than inferring support from a type or ABI.

## Failure and fallback rules

- Every RPC client verifies `eth_chainId`; mismatch fails the request/readiness check.
- HTTP RPC methods are allowlisted and exclude send/sign methods.
- Multiple endpoints may be attempted for reads. The same logical read may be retried; no write method can be duplicated.
- Invalid address/bytecode responses, missing addresses, missing pinned hashes, and wrong-chain resolution fail closed.
- API requests may select `chainId=11155111`; all other chain IDs return a client error.
- Errors returned externally are coarse and do not reveal provider URLs or credentials.

## State isolation

PostgreSQL primary/unique keys include `chain_id` for deployments, capabilities, vaults, headers, logs, cursors, balances, and transaction observations. Redis/job callers must use `chainScopedKey`. The durable outbox is globally idempotent; a future chain producer must include the chain scope in its idempotency key and payload.

## Expansion checklist

Add a disabled chain config and chain-specific RPCs; deploy and verify contracts; add a real versioned manifest; register only verified capabilities; audit all storage/cache/job identifiers; test chain mismatch, reorgs, deployment gaps and isolation; obtain approvals; then explicitly enable it. The present environment parser intentionally needs a reviewed code change before more than Sepolia can become active.
