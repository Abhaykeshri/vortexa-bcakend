import type {
  Address,
  ChainEvent,
  ChainId,
  FeatureKey,
  FeatureStatus,
  Position,
  PositionListCursor,
  ProjectionState,
  PinnedVaultState,
  PinnedWalletPosition,
  TransactionIntent,
  UnsignedIntent,
  Vault,
  VaultEventCursor,
  VaultListCursor,
  VaultProjection,
  VaultProjectionEvent,
  WalletVaultPosition,
} from './types.js';
import type {
  CreateVaultCommand,
  DepositCommand,
  ManagerRebalanceCommand,
  ManagerUpdateCommand,
  PoolDescriptor,
  PoolKey,
  PoolStatus,
  TransactionPlan,
  VaultConfigInput,
  WithdrawCommand,
} from './vault-ui.js';
export interface VaultReaderPort {
  getVault(chainId: ChainId, vault: Address): Promise<Vault | null>;
}
export interface CapabilityPort {
  status(chainId: ChainId, feature: FeatureKey): Promise<FeatureStatus>;
}
export interface ChainStatePort {
  finalizedBlock(chainId: ChainId): Promise<bigint>;
}
export interface IntentSimulatorPort {
  simulate(intent: UnsignedIntent): Promise<{ ok: boolean; reason?: string }>;
}
export interface AuditPort {
  record(event: { action: string; chainId: ChainId; target: Address; outcome: string }): Promise<void>;
}
export interface ClockPort {
  now(): Date;
}
export interface VaultRepositoryPort {
  save(vault: Vault): Promise<void>;
  find(chainId: ChainId, address: Address): Promise<Vault | null>;
}
export interface PositionRepositoryPort {
  save(position: Position): Promise<void>;
  listByWallet(chainId: ChainId, wallet: Address): Promise<readonly Position[]>;
}
export interface ChainEventSourcePort {
  list(fromBlock: bigint, toBlock: bigint): Promise<readonly ChainEvent[]>;
}
export interface IntentSignerPort {
  sign(intent: TransactionIntent): Promise<`0x${string}`>;
}
export interface CachePort {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}
export interface LeasePort {
  acquire(key: string, owner: string, ttlMs: number): Promise<boolean>;
  renew(key: string, owner: string, ttlMs: number): Promise<boolean>;
  release(key: string, owner: string): Promise<boolean>;
}

export interface VaultCatalogRepositoryPort {
  projectionState(chainId: ChainId): Promise<ProjectionState | null>;
  listVaults(
    chainId: ChainId,
    snapshotBlock: bigint,
    cursor: VaultListCursor | null,
    limit: number,
  ): Promise<readonly VaultProjection[]>;
  findVault(chainId: ChainId, address: Address): Promise<VaultProjection | null>;
  listVaultEvents(
    chainId: ChainId,
    vault: Address,
    snapshotBlock: bigint,
    cursor: VaultEventCursor | null,
    limit: number,
  ): Promise<readonly VaultProjectionEvent[]>;
  listWalletPositions(
    chainId: ChainId,
    wallet: Address,
    snapshotBlock: bigint,
    cursor: PositionListCursor | null,
    limit: number,
  ): Promise<readonly WalletVaultPosition[]>;
  listVaultHolders(chainId: ChainId, vault: Address): Promise<readonly WalletVaultPosition[]>;
}

export interface PinnedVaultStateReaderPort {
  vaultState(chainId: ChainId, vault: Address, blockNumber: bigint): Promise<PinnedVaultState>;
  walletPosition(
    chainId: ChainId,
    vault: Address,
    wallet: Address,
    blockNumber: bigint,
  ): Promise<PinnedWalletPosition>;
}

export interface PinnedProjectionWriterPort {
  savePinnedSnapshot(input: {
    chainId: ChainId;
    blockNumber: bigint;
    blockHash: `0x${string}`;
    finality: VaultProjection['finality'];
    vaults: readonly PinnedVaultState[];
    positions: readonly PinnedWalletPosition[];
  }): Promise<void>;
}

/** Read and unsigned-transaction boundary used by the four V2 vault screens. */
export interface VaultUiChainPort {
  listPools(): Promise<readonly PoolStatus[]>;
  listShapes(): Promise<readonly { id: number; valid: boolean }[]>;
  previewShape(input: {
    shapeId: number;
    centerTick: number;
    ticksLeft: number;
    ticksRight: number;
    tickSpacing: number;
  }): Promise<{ bands: readonly unknown[]; weights: readonly number[] }>;
  validateConfig(config: VaultConfigInput): Promise<{
    pool: PoolStatus;
    violations: readonly { field: string; code: string }[];
  }>;
  vaultInfo(vault: Address): Promise<unknown>;
  userPosition(vault: Address, user: Address): Promise<unknown>;
  walletBalances(vault: Address, user: Address): Promise<unknown>;
  buildCreate(command: CreateVaultCommand): Promise<TransactionPlan>;
  buildDeposit(command: DepositCommand): Promise<TransactionPlan>;
  buildWithdraw(command: WithdrawCommand): Promise<TransactionPlan>;
  buildManagerUpdate(command: ManagerUpdateCommand): Promise<TransactionPlan>;
  buildManagerRebalance(command: ManagerRebalanceCommand): Promise<TransactionPlan>;
}

export interface PoolRegistryPort {
  readonly pools: readonly PoolDescriptor[];
  find(key: PoolKey): PoolDescriptor | undefined;
}
