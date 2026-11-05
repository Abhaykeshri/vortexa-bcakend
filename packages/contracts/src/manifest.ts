import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export interface ManifestContract {
  readonly name: string;
  readonly address?: `0x${string}`;
  readonly role?: 'implementation';
  readonly runtimeCodeHash?: `0x${string}`;
}
export interface DeploymentManifest {
  readonly schemaVersion: 1;
  readonly manifestVersion: string;
  readonly chainId: number;
  readonly network: string;
  readonly contracts: Readonly<Record<string, ManifestContract>>;
  readonly factoryStartBlock?: number;
  readonly pools?: readonly {
    readonly id: `0x${string}`;
    readonly label: string;
    readonly currency0: `0x${string}`;
    readonly currency1: `0x${string}`;
    readonly fee: number;
    readonly tickSpacing: number;
    readonly hooks: `0x${string}`;
  }[];
}

/**
 * Loads and validates a chain-scoped deployment manifest.
 * Addresses and runtime hashes are validated syntactically here; live bytecode
 * identity is checked separately by the contract verification command.
 */
export function loadManifest(path = 'packages/contracts/manifests/sepolia-v1.json'): DeploymentManifest {
  const parsed = JSON.parse(readFileSync(resolve(path), 'utf8')) as Partial<DeploymentManifest>;
  if (
    parsed.schemaVersion !== 1 ||
    !Number.isSafeInteger(parsed.chainId) ||
    !parsed.network ||
    !parsed.manifestVersion ||
    !parsed.contracts
  )
    throw new Error('Invalid deployment manifest');
  for (const [key, contract] of Object.entries(parsed.contracts)) {
    if (
      !/^[A-Z][A-Z0-9_]*$/.test(key) ||
      !contract?.name ||
      (contract.address !== undefined && !/^0x[a-fA-F0-9]{40}$/.test(contract.address)) ||
      (contract.runtimeCodeHash !== undefined && !/^0x[a-fA-F0-9]{64}$/.test(contract.runtimeCodeHash))
    )
      throw new Error(`Invalid manifest contract: ${key}`);
  }
  if (
    parsed.factoryStartBlock !== undefined &&
    (!Number.isSafeInteger(parsed.factoryStartBlock) || parsed.factoryStartBlock < 0)
  )
    throw new Error('Invalid factory start block');
  for (const pool of parsed.pools ?? []) {
    if (
      !/^0x[a-fA-F0-9]{64}$/.test(pool.id) ||
      !pool.label ||
      !/^0x[a-fA-F0-9]{40}$/.test(pool.currency0) ||
      !/^0x[a-fA-F0-9]{40}$/.test(pool.currency1) ||
      !Number.isSafeInteger(pool.fee) ||
      !Number.isSafeInteger(pool.tickSpacing) ||
      pool.tickSpacing <= 0 ||
      !/^0x[a-fA-F0-9]{40}$/.test(pool.hooks)
    )
      throw new Error('Invalid manifest pool');
  }
  return parsed as DeploymentManifest;
}
