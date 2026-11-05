import type { Config } from './config/env.js';
import type { VaultQueryService } from '../../../packages/application/src/vault-query.service.js';
import type { VaultUiService } from '../../../packages/application/src/vault-ui.service.js';

export interface ChainReadPort {
  verifyNetwork(): Promise<void>;
  latestBlock(): Promise<bigint>;
  finalizedBlock(chainId: number): Promise<bigint>;
  inspect(address: `0x${string}`): Promise<unknown>;
}

export interface ContractReadPort {
  runtimeCodeHash(address: `0x${string}`): Promise<`0x${string}`>;
  read(contractName: string, address: `0x${string}`, functionName: string): Promise<unknown>;
}

export interface ContractRegistryPort {
  resolve(chainId: number, contract: string): `0x${string}`;
}

export interface ApiDependencies {
  readonly config: Config;
  readonly chain: ChainReadPort;
  readonly contractReader: ContractReadPort;
  readonly contractRegistry: ContractRegistryPort;
  readonly vaultQueryService?: VaultQueryService;
  readonly vaultUiService?: VaultUiService;
  readonly limiter?: import('./http-security.js').RateLimiter;
  readonly checkPostgres: () => Promise<boolean>;
  readonly checkRedis: () => Promise<boolean>;
  readonly log: (
    level: 'debug' | 'info' | 'warn' | 'error',
    event: string,
    detail?: Record<string, unknown>,
  ) => void;
}
