import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ChainCapabilityRegistry,
  ChainRegistry,
  ContractRegistry,
  RpcClientFactory,
  UnsupportedChainError,
  chainScopedKey,
  type ChainConfig,
} from '../packages/adapters/src/chain-registry.js';
import type { DeploymentManifest } from '../packages/contracts/src/manifest.js';

const address = `0x${'1'.repeat(40)}` as const;
function chainConfig(chainId: 11155111 | 1, enabled: boolean): ChainConfig {
  return {
    chainId,
    name: chainId === 11155111 ? 'Ethereum Sepolia' : 'Disabled future chain',
    enabled,
    rpcUrls: ['https://rpc.example.org'],
    rpcTimeoutMs: 1000,
    rpcMaxRetries: 0,
    confirmations: 12,
    manifest: {
      schemaVersion: 1,
      manifestVersion: `test-${chainId}`,
      chainId,
      network: chainId === 11155111 ? 'sepolia' : 'disabled',
      contracts: { VAULT: { name: 'Vault' } },
    } satisfies DeploymentManifest,
    contracts: { VAULT: address },
    capabilities: { 'vault.depositPair': chainId === 11155111 ? 'SUPPORTED' : 'UNSUPPORTED' },
  };
}

test('registry exposes only enabled Sepolia and rejects disabled future chains', () => {
  const registry = new ChainRegistry([chainConfig(11155111, true), chainConfig(1, false)], 11155111);
  assert.deepEqual(
    registry.active().map((chain) => chain.chainId),
    [11155111],
  );
  assert.throws(() => registry.resolve(1), UnsupportedChainError);
  assert.throws(() => registry.resolve(8453), UnsupportedChainError);
});

test('contract and capability resolution are chain-aware and fail closed', () => {
  const registry = new ChainRegistry([chainConfig(11155111, true)], 11155111);
  assert.equal(new ContractRegistry(registry).resolve(11155111, 'VAULT'), address);
  assert.throws(() => new ContractRegistry(registry).resolve(11155111, 'ZAP'), /Missing deployment/);
  const capabilities = new ChainCapabilityRegistry(registry);
  assert.equal(capabilities.resolve(11155111, 'vault.depositPair'), 'SUPPORTED');
  assert.equal(capabilities.resolve(11155111, 'vault.userRebalance'), 'UNSUPPORTED');
});

test('RPC clients verify the provider-reported chain ID', async () => {
  const registry = new ChainRegistry([chainConfig(11155111, true)], 11155111);
  const good = new RpcClientFactory(registry, () => ({ request: async () => '0xaa36a7' })).create(11155111);
  await good.verifyNetwork();
  const wrong = new RpcClientFactory(registry, () => ({ request: async () => '0x1' })).create(11155111);
  await assert.rejects(() => wrong.verifyNetwork(), /chain mismatch/);
});

test('chain-scoped keys prevent cache and job collisions', () => {
  assert.equal(chainScopedKey(11155111, 'vault_abc'), 'chain_11155111_vault_abc');
  assert.notEqual(chainScopedKey(11155111, 'job_1'), chainScopedKey(1, 'job_1'));
  assert.throws(() => chainScopedKey(11155111, 'unsafe:key'));
});
