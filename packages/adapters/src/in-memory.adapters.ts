import type {
  AuditPort,
  CapabilityPort,
  ChainEventSourcePort,
  ClockPort,
  IntentSimulatorPort,
  PositionRepositoryPort,
  VaultReaderPort,
  VaultRepositoryPort,
} from '../../domain/src/ports.js';
import type {
  Address,
  ChainEvent,
  ChainId,
  FeatureKey,
  FeatureStatus,
  Position,
  UnsignedIntent,
  Vault,
} from '../../domain/src/types.js';
export class InMemoryVaultAdapter implements VaultReaderPort, VaultRepositoryPort {
  private readonly data = new Map<string, Vault>();
  private key(chainId: ChainId, address: Address): string {
    return `${chainId}:${address.toLowerCase()}`;
  }
  async save(vault: Vault): Promise<void> {
    this.data.set(this.key(vault.chainId, vault.address), vault);
  }
  async find(chainId: ChainId, address: Address): Promise<Vault | null> {
    return this.data.get(this.key(chainId, address)) ?? null;
  }
  async getVault(chainId: ChainId, address: Address): Promise<Vault | null> {
    return this.find(chainId, address);
  }
}
export class StaticCapabilityAdapter implements CapabilityPort {
  constructor(private readonly statuses: Readonly<Partial<Record<FeatureKey, FeatureStatus>>> = {}) {}
  async status(_chainId: ChainId, feature: FeatureKey): Promise<FeatureStatus> {
    return this.statuses[feature] ?? 'PENDING_CONTRACT';
  }
}
export class MockSimulator implements IntentSimulatorPort {
  constructor(private readonly allowed = true) {}
  async simulate(_intent: UnsignedIntent): Promise<{ ok: boolean; reason?: string }> {
    void _intent;
    return this.allowed ? { ok: true } : { ok: false, reason: 'Mock revert' };
  }
}
export class InMemoryAudit implements AuditPort {
  readonly events: Array<{ action: string; chainId: ChainId; target: Address; outcome: string }> = [];
  async record(event: { action: string; chainId: ChainId; target: Address; outcome: string }): Promise<void> {
    this.events.push(event);
  }
}
export class InMemoryPositionAdapter implements PositionRepositoryPort {
  private readonly positions = new Map<string, Position>();
  async save(position: Position): Promise<void> {
    this.positions.set(
      `${position.chainId}:${position.vault.toLowerCase()}:${position.wallet.toLowerCase()}`,
      position,
    );
  }
  async listByWallet(chainId: ChainId, wallet: Address): Promise<readonly Position[]> {
    return [...this.positions.values()].filter(
      (x) => x.chainId === chainId && x.wallet.toLowerCase() === wallet.toLowerCase(),
    );
  }
}
export class InMemoryEventSource implements ChainEventSourcePort {
  constructor(private readonly events: readonly ChainEvent[] = []) {}
  async list(fromBlock: bigint, toBlock: bigint): Promise<readonly ChainEvent[]> {
    return this.events.filter((x) => x.blockNumber >= fromBlock && x.blockNumber <= toBlock);
  }
}
export class FixedClock implements ClockPort {
  constructor(private readonly value: Date) {}
  now(): Date {
    return new Date(this.value);
  }
}
