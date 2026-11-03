import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDotEnv, loadConfig } from '../apps/api/src/config/env.js';
import type { DeploymentManifest } from '../packages/contracts/src/manifest.js';
import {
  SepoliaReadAdapter,
  JsonRpcHttpAdapter,
  FailoverRpcAdapter,
} from '../packages/adapters/src/sepolia-rpc.js';
const addr = '0x' + '1'.repeat(40);
const env: Record<string, string> = {
  NODE_ENV: 'test',
  CHAIN_ID: '11155111',
  SEPOLIA_RPC_URL: 'https://rpc.example.org',
};
const manifest = {
  schemaVersion: 1,
  manifestVersion: 'test-v1',
  chainId: 11155111,
  network: 'sepolia',
  contracts: {
    ZAP: { name: 'Zap', address: addr },
    PRICE_GUARD: { name: 'PriceGuard', address: addr },
    SHAPE_LIBRARY: { name: 'ShapeLibrary', address: addr },
    TIMELOCK_CONTROLLER: { name: 'TimelockController', address: addr },
    VAULT: { name: 'Vault', address: addr },
    VAULT_FACTORY: { name: 'VaultFactory', address: addr },
    VAULT_LENS: { name: 'VaultLens', address: addr },
    FEE_COLLECTOR: { name: 'FeeCollector', address: addr },
    NORMAL_LP_STRATEGY: { name: 'NormalLPStrategy', address: addr },
    BUY_THE_DIP_STRATEGY: { name: 'BuyTheDipStrategy', address: addr },
    SELL_THE_PUMP_STRATEGY: { name: 'SellThePumpStrategy', address: addr },
    SWAP_EXECUTOR: { name: 'SwapExecutor', address: addr },
  },
} as DeploymentManifest;
test('dotenv parser supports comments and quoted values', () => {
  assert.equal(
    JSON.stringify(parseDotEnv('# hi\nFOO="bar"\nX=hello\n')),
    JSON.stringify({ FOO: 'bar', X: 'hello' }),
  );
});
test('configuration accepts valid Sepolia deployment', () =>
  assert.equal(loadConfig(env, manifest).contracts.ZAP, addr));
test('configuration rejects wrong chain', () =>
  assert.throws(() => loadConfig({ ...env, CHAIN_ID: '1' }, manifest)));
test('configuration rejects environment address overrides', () =>
  assert.throws(() => loadConfig({ ...env, CONTRACT_ZAP: '0x' + '2'.repeat(40) }, manifest)));
test('configuration rejects missing RPC', () =>
  assert.throws(() => loadConfig({ ...env, SEPOLIA_RPC_URL: '' }, manifest)));
test('read adapter verifies chain and deployed bytecode', async () => {
  const rpc = {
    request: async (method: string) =>
      method === 'eth_chainId' ? '0xaa36a7' : method === 'eth_getCode' ? '0x6001' : '0x64',
  };
  const chain = new SepoliaReadAdapter(rpc, 12, 11155111);
  await chain.verifyNetwork();
  assert.equal((await chain.inspect(addr as `0x${string}`)).deployed, true);
  assert.equal(await chain.finalizedBlock(11155111), 88n);
});
test('read adapter rejects wrong chain', async () => {
  const chain = new SepoliaReadAdapter({ request: async () => '0x1' }, 12, 11155111);
  await assert.rejects(() => chain.verifyNetwork());
});
test('RPC transport denies unsafe methods', async () => {
  const rpc = new JsonRpcHttpAdapter('https://example.org');
  await assert.rejects(() => rpc.request('eth_sendRawTransaction'));
});
test('RPC failover uses a healthy secondary provider', async () => {
  const rpc = new FailoverRpcAdapter([
    {
      request: async () => {
        throw new Error('down');
      },
    },
    { request: async () => '0xaa36a7' },
  ]);
  assert.equal(await rpc.request('eth_chainId'), '0xaa36a7');
});
