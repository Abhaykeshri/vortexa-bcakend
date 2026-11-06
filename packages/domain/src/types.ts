export type ChainId = 11155111 | 1;
export type Address = `0x${string}`;
export type FeatureStatus = 'SUPPORTED' | 'PENDING_CONTRACT' | 'UNSUPPORTED';
export type FeatureKey =
  | 'vault.create'
  | 'vault.depositPair'
  | 'vault.withdrawPair'
  | 'vault.zapDeposit'
  | 'vault.userRebalance'
  | 'vault.updateConfig'
  | 'vault.owner'
  | 'vault.limitMethod'
  | 'vault.assetRatioMethod'
  | 'vault.dexAggregator'
  | 'vault.limitPosition'
  | 'vault.automationFunding'
  | 'vault.tokenWeights'
  | 'vault.carpetLiquidity'
  | 'vault.advancedShapes'
  | 'vault.thirtyBands'
  | 'vault.asymmetricTriggers'
  | 'vault.keeperConfig'
  | 'vault.singleTokenWithdraw'
  | 'vault.customRatioWithdraw'
  | 'vault.autoBalanceDeposit'
  | 'vault.createAndDeposit'
  | 'vault.pooledOrderbookPerp';
export interface Vault {
  readonly chainId: ChainId;
  readonly address: Address;
  readonly strategy: 'NormalLP' | 'BuyDip' | 'SellPump';
  readonly shapeId: number;
  readonly ownerRole: 'GOVERNANCE_ONLY' | 'VAULT_MANAGER';
  readonly asOfBlock: bigint;
}
export interface UnsignedIntent {
  readonly chainId: ChainId;
  readonly to: Address;
  readonly data: `0x${string}`;
  readonly value: bigint;
  readonly simulatedAtBlock: bigint;
}
export interface Position {
  readonly chainId: ChainId;
  readonly vault: Address;
  readonly wallet: Address;
  readonly shares: bigint;
  readonly asOfBlock: bigint;
}
export interface Strategy {
  readonly kind: Vault['strategy'];
  readonly contract: Address;
  readonly allowedShapeIds: readonly number[];
}
export interface LiquidityShape {
  readonly id: number;
  readonly name: string;
  readonly bandCount: number;
  readonly oneSided: boolean;
}
export interface Capability {
  readonly chainId: ChainId;
  readonly feature: FeatureKey;
  readonly status: FeatureStatus;
  readonly reason: string;
}
export interface RebalanceEligibility {
  readonly eligible: boolean;
  readonly reasons: readonly (
    'PAUSED' | 'AUTO_OFF' | 'COOLDOWN' | 'STALE_PRICE' | 'TRIGGER_NOT_MET' | 'UNAUTHORIZED'
  )[];
  readonly asOfBlock: bigint;
}
export interface ChainEvent {
  readonly chainId: ChainId;
  readonly blockNumber: bigint;
  readonly blockHash: `0x${string}`;
  readonly transactionHash: `0x${string}`;
  readonly logIndex: number;
  readonly address: Address;
  readonly eventName: string;
  readonly finality: 'OBSERVED' | 'CONFIRMED' | 'FINALIZED';
}
export interface TransactionIntent extends UnsignedIntent {
  readonly selector: `0x${string}`;
  readonly caller: Address;
  readonly deadline: bigint;
}
export interface PortfolioSnapshot {
  readonly chainId: ChainId;
  readonly wallet: Address;
  readonly positions: readonly Position[];
  readonly asOfBlock: bigint;
}

export type ProjectionFinality = 'OBSERVED' | 'CONFIRMED' | 'FINALIZED';

export interface VaultProjection {
  readonly chainId: ChainId;
  readonly address: Address;
  readonly factoryAddress: Address;
  readonly creator: Address;
  readonly creationTransactionHash: `0x${string}`;
  readonly creationBlock: bigint;
  readonly poolId: `0x${string}`;
  readonly strategy: Vault['strategy'];
  readonly strategyContract: Address;
  readonly shapeId: number | null;
  readonly name?: string | null;
  readonly symbol?: string | null;
  readonly manager?: Address | null;
  readonly paused?: boolean | null;
  readonly inRange?: boolean | null;
  readonly poolTick?: number | null;
  readonly config: Readonly<Record<string, unknown>> | null;
  readonly totalShares: bigint;
  readonly totalAssets: bigint | null;
  readonly totalAssets0: bigint | null;
  readonly totalAssets1: bigint | null;
  readonly accountingAvailable: boolean;
  readonly finality: ProjectionFinality;
  readonly indexedThroughBlock: bigint;
  readonly indexedBlockHash: `0x${string}`;
}

export interface WalletVaultPosition {
  readonly chainId: ChainId;
  readonly vaultAddress: Address;
  readonly walletAddress: Address;
  readonly shares: bigint;
  readonly amount0: bigint | null;
  readonly amount1: bigint | null;
  readonly accountingAvailable: boolean;
  readonly finality: ProjectionFinality;
  readonly asOfBlock: bigint;
  readonly indexedBlockHash: `0x${string}`;
}

export interface VaultProjectionEvent extends ChainEvent {
  readonly transactionIndex: number;
  readonly eventArgs: Readonly<Record<string, unknown>> | null;
}

export interface ProjectionState {
  readonly chainId: ChainId;
  readonly generation: bigint;
  readonly indexedThroughBlock: bigint;
  readonly indexedBlockHash: `0x${string}`;
  readonly finality: ProjectionFinality;
}

export interface VaultListCursor {
  readonly creationBlock: bigint;
  readonly address: Address;
}

export interface VaultEventCursor {
  readonly blockNumber: bigint;
  readonly transactionIndex: number;
  readonly logIndex: number;
}

export interface PositionListCursor {
  readonly vaultAddress: Address;
}

export interface PinnedVaultState {
  readonly vaultAddress: Address;
  readonly blockNumber: bigint;
  readonly blockHash: `0x${string}`;
  readonly strategyContract: Address;
  readonly config: Readonly<Record<string, unknown>>;
  readonly totalShares: bigint;
  readonly totalAssets: bigint;
  readonly totalAssets0: bigint | null;
  readonly totalAssets1: bigint | null;
  readonly accountingAvailable: boolean;
  readonly name?: string;
  readonly symbol?: string;
  readonly manager?: Address;
  readonly paused?: boolean;
  readonly inRange?: boolean;
  readonly poolTick?: number;
}

export interface VaultHistoricalSnapshot {
  readonly chainId: ChainId;
  readonly vaultAddress: Address;
  readonly bucket: Date;
  readonly blockNumber: bigint;
  readonly totalShares: bigint;
  readonly totalAssets: bigint;
  readonly totalAssets0: bigint | null;
  readonly totalAssets1: bigint | null;
  readonly poolTick: number | null;
  readonly inRange: boolean | null;
}

export interface PinnedWalletPosition {
  readonly vaultAddress: Address;
  readonly walletAddress: Address;
  readonly blockNumber: bigint;
  readonly shares: bigint;
  readonly amount0: bigint | null;
  readonly amount1: bigint | null;
  readonly accountingAvailable: boolean;
}
