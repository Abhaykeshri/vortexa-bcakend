import { DomainError } from '../../domain/src/errors.js';
import { assertPositiveAmount } from '../../domain/src/validation.js';
import type {
  AuditPort,
  CapabilityPort,
  IntentSimulatorPort,
  VaultReaderPort,
} from '../../domain/src/ports.js';
import type {
  Address,
  ChainId,
  FeatureKey,
  FeatureStatus,
  UnsignedIntent,
  Vault,
} from '../../domain/src/types.js';
export class GetVault {
  constructor(private readonly reader: VaultReaderPort) {}
  async execute(chainId: ChainId, address: Address): Promise<Vault> {
    const vault = await this.reader.getVault(chainId, address);
    if (!vault) throw new DomainError('NOT_FOUND', 'Vault not found');
    if (vault.chainId !== chainId || vault.address.toLowerCase() !== address.toLowerCase())
      throw new DomainError('STALE_STATE', 'Adapter returned wrong vault');
    return vault;
  }
}
export class GetCapabilities {
  constructor(private readonly capabilities: CapabilityPort) {}
  async execute(chainId: ChainId, features: readonly FeatureKey[]): Promise<Record<string, FeatureStatus>> {
    const result: Record<string, FeatureStatus> = {};
    for (const feature of features) result[feature] = await this.capabilities.status(chainId, feature);
    return result;
  }
}
export class PreparePairDeposit {
  constructor(
    private readonly capabilities: CapabilityPort,
    private readonly simulator: IntentSimulatorPort,
    private readonly audit: AuditPort,
  ) {}
  async execute(input: {
    chainId: ChainId;
    vault: Address;
    amount0: bigint;
    amount1: bigint;
    encodedData: `0x${string}`;
    pinnedBlock: bigint;
  }): Promise<UnsignedIntent> {
    if ((await this.capabilities.status(input.chainId, 'vault.depositPair')) !== 'SUPPORTED')
      throw new DomainError('CONTRACT_PENDING', 'Deposit not supported by verified deployment');
    assertPositiveAmount(input.amount0 + input.amount1);
    if (input.amount0 < 0n || input.amount1 < 0n) throw new DomainError('INVALID_INPUT', 'Negative amount');
    // Calldata MUST come from a trusted, ABI-verified adapter, never directly from a client request.
    if (input.encodedData === '0x') throw new DomainError('INVALID_INPUT', 'Empty calldata');
    const intent: UnsignedIntent = {
      chainId: input.chainId,
      to: input.vault,
      data: input.encodedData,
      value: 0n,
      simulatedAtBlock: input.pinnedBlock,
    };
    const simulation = await this.simulator.simulate(intent);
    await this.audit.record({
      action: 'depositPair.prepare',
      chainId: input.chainId,
      target: input.vault,
      outcome: simulation.ok ? 'SIMULATED' : 'REJECTED',
    });
    if (!simulation.ok) throw new DomainError('STALE_STATE', simulation.reason ?? 'Simulation failed');
    return intent;
  }
}
export class RequireFeature {
  constructor(private readonly capabilities: CapabilityPort) {}
  async execute(chainId: ChainId, feature: FeatureKey): Promise<void> {
    const status = await this.capabilities.status(chainId, feature);
    if (status !== 'SUPPORTED')
      throw new DomainError(
        status === 'PENDING_CONTRACT' ? 'CONTRACT_PENDING' : 'UNSUPPORTED_FEATURE',
        `${feature}: ${status}`,
      );
  }
}
