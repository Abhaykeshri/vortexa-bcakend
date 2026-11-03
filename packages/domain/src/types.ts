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
