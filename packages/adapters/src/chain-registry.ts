import type { Address, ChainId, FeatureKey, FeatureStatus } from '../../domain/src/types.js';
import type { DeploymentManifest } from '../../contracts/src/manifest.js';
import {
  FailoverRpcAdapter,
  JsonRpcHttpAdapter,
  EvmChainReadAdapter,
  type RpcTransport,
} from './sepolia-rpc.js';
import { ContractReader } from './contract-reader.js';

export interface ChainConfig {
  readonly chainId: ChainId;
  readonly name: string;
  readonly enabled: boolean;
  readonly rpcUrls: readonly string[];
  readonly rpcTimeoutMs: number;
  readonly rpcMaxRetries: number;
  readonly confirmations: number;
  readonly manifest: DeploymentManifest;
  readonly contracts: Readonly<Record<string, Address>>;
  readonly capabilities: Readonly<Partial<Record<FeatureKey, FeatureStatus>>>;
}

export class UnsupportedChainError extends Error {
  constructor(chainId: number) {
    super(`Unsupported or disabled chain: ${chainId}`);
    this.name = 'UnsupportedChainError';
  }
}

export class ChainRegistry {
  private readonly chains = new Map<number, ChainConfig>();

  constructor(
    configs: readonly ChainConfig[],
    readonly defaultChainId: ChainId,
  ) {
    for (const config of configs) {
      if (this.chains.has(config.chainId))
        throw new Error(`Duplicate chain configuration: ${config.chainId}`);
      if (config.manifest.chainId !== config.chainId) throw new Error('Chain manifest mismatch');
      if (config.rpcUrls.length === 0) throw new Error('Chain requires an RPC endpoint');
      this.chains.set(config.chainId, config);
    }
    this.resolve(defaultChainId);
  }

  resolve(chainId: number): ChainConfig {
    const config = this.chains.get(chainId);
    if (!config?.enabled) throw new UnsupportedChainError(chainId);
    return config;
  }

  active(): readonly ChainConfig[] {
    return [...this.chains.values()].filter((chain) => chain.enabled);
  }
}

export class RpcClientFactory {
  constructor(
    private readonly registry: ChainRegistry,
    private readonly transportFactory: (url: string, timeoutMs: number, retries: number) => RpcTransport = (
      url,
      timeoutMs,
      retries,
    ) => new JsonRpcHttpAdapter(url, timeoutMs, retries),
  ) {}

  create(chainId: number): EvmChainReadAdapter {
    const chain = this.registry.resolve(chainId);
    const transports = chain.rpcUrls.map((url) =>
      this.transportFactory(url, chain.rpcTimeoutMs, chain.rpcMaxRetries),
    );
    const transport = transports.length === 1 ? transports[0]! : new FailoverRpcAdapter(transports);
    return new EvmChainReadAdapter(transport, chain.confirmations, chain.chainId);
  }
}

export class ContractRegistry {
  constructor(private readonly chains: ChainRegistry) {}

  resolve(chainId: number, contract: string): Address {
    const address = this.chains.resolve(chainId).contracts[contract];
    if (!address) throw new Error(`Missing deployment for ${contract} on chain ${chainId}`);
    return address;
  }
}

export class ChainCapabilityRegistry {
  constructor(private readonly chains: ChainRegistry) {}

  resolve(chainId: number, feature: FeatureKey): FeatureStatus {
    return this.chains.resolve(chainId).capabilities[feature] ?? 'UNSUPPORTED';
  }
}

export class ChainAwareContractReader {
  constructor(private readonly chains: ChainRegistry) {}

  reader(chainId: number): ContractReader {
    const chain = this.chains.resolve(chainId);
    return new ContractReader(chain.rpcUrls, chain.chainId);
  }
}

export function chainScopedKey(chainId: number, key: string): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('Invalid chain ID');
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(key)) throw new Error('Invalid chain-scoped key');
  return `chain_${chainId}_${key}`;
}
