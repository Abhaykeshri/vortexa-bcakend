import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export interface ManifestContract {
  readonly name: string;
  readonly runtimeCodeHash?: `0x${string}`;
}
export interface DeploymentManifest {
  readonly schemaVersion: 1;
  readonly manifestVersion: string;
  readonly chainId: number;
  readonly network: string;
  readonly contracts: Readonly<Record<string, ManifestContract>>;
}

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
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || !contract?.name)
      throw new Error(`Invalid manifest contract: ${key}`);
  }
  return parsed as DeploymentManifest;
}
