import type { Config } from './config/env.js';
import type { M7QueryService } from '../../../packages/application/src/m7-queries.js';

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
  readonly m7Service?: M7QueryService;
  readonly limiter?: import('./security.js').RateLimiter;
  readonly checkPostgres: () => Promise<boolean>;
  readonly checkRedis: () => Promise<boolean>;
  readonly log: (
    level: 'debug' | 'info' | 'warn' | 'error',
    event: string,
    detail?: Record<string, unknown>,
  ) => void;
}
