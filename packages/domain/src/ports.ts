import type {
  Address,
  ChainEvent,
  ChainId,
  FeatureKey,
  FeatureStatus,
  Position,
  TransactionIntent,
  UnsignedIntent,
  Vault,
} from './types.js';
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
