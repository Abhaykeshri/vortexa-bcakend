import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Address } from '../../domain/src/types.js';

export interface ManifestContract {
  readonly name: string;
  readonly address: Address;
  readonly runtimeCodeHash?: `0x${string}`;
}
export interface DeploymentManifest {
  readonly schemaVersion: 1;
  readonly manifestVersion: string;
  readonly chainId: 11155111;
  readonly network: 'sepolia';
  readonly contracts: Readonly<Record<string, ManifestContract>>;
}

export function loadManifest(
  path = process.env.CONTRACT_MANIFEST_PATH ?? 'packages/contracts/manifests/sepolia-v1.json',
): DeploymentManifest {
  const parsed = JSON.parse(readFileSync(resolve(path), 'utf8')) as Partial<DeploymentManifest>;
  if (
    parsed.schemaVersion !== 1 ||
    parsed.chainId !== 11155111 ||
    parsed.network !== 'sepolia' ||
    !parsed.manifestVersion ||
    !parsed.contracts
  )
    throw new Error('Invalid deployment manifest');
  for (const [key, contract] of Object.entries(parsed.contracts)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || !contract || !/^0x[a-fA-F0-9]{40}$/.test(contract.address))
      throw new Error(`Invalid manifest contract: ${key}`);
  }
  return parsed as DeploymentManifest;
}
