import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDotEnv, readEnvironment, loadConfig } from '../apps/api/src/config/env.js';
import type { DeploymentManifest } from '../packages/contracts/src/manifest.js';
import {
  SepoliaReadAdapter,
  JsonRpcHttpAdapter,
  FailoverRpcAdapter,
} from '../packages/adapters/src/sepolia-rpc.js';
const addr = '0x' + '1'.repeat(40);
const manifest = {
  schemaVersion: 1,
  manifestVersion: 'test-v1',
  chainId: 11155111,
  network: 'sepolia',
  contracts: {
    ZAP: { name: 'Zap' },
    PRICE_GUARD: { name: 'PriceGuard' },
    SHAPE_LIBRARY: { name: 'ShapeLibrary' },
    TIMELOCK_CONTROLLER: { name: 'TimelockController' },
    VAULT: { name: 'Vault' },
    VAULT_FACTORY: { name: 'VaultFactory' },
    VAULT_LENS: { name: 'VaultLens' },
    FEE_COLLECTOR: { name: 'FeeCollector' },
    NORMAL_LP_STRATEGY: { name: 'NormalLPStrategy' },
    BUY_THE_DIP_STRATEGY: { name: 'BuyTheDipStrategy' },
    SELL_THE_PUMP_STRATEGY: { name: 'SellThePumpStrategy' },
    SWAP_EXECUTOR: { name: 'SwapExecutor' },
  },
} as DeploymentManifest;
const env: Record<string, string> = {
  NODE_ENV: 'test',
  CHAIN_ID: '11155111',
  SEPOLIA_RPC_URL: 'https://rpc.example.org',
  ...Object.fromEntries(Object.keys(manifest.contracts).map((key) => [`CONTRACT_${key}`, addr])),
};
test('dotenv parser supports comments and quoted values', () => {
  assert.equal(
    JSON.stringify(parseDotEnv('# hi\nFOO="bar"\nX=hello\n')),
    JSON.stringify({ FOO: 'bar', X: 'hello' }),
  );
});
test('development environment precedence is process > environment local > local > environment > base', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vortexa-env-'));
  try {
    writeFileSync(join(directory, '.env'), 'VALUE=base\nBASE_ONLY=yes\n');
    writeFileSync(join(directory, '.env.test'), 'VALUE=environment\n');
    writeFileSync(join(directory, '.env.local'), 'VALUE=local\n');
    writeFileSync(join(directory, '.env.test.local'), 'VALUE=environment-local\n');
    const loaded = readEnvironment(directory, { NODE_ENV: 'test', VALUE: 'process' });
    assert.equal(loaded.VALUE, 'process');
    assert.equal(loaded.BASE_ONLY, 'yes');
    assert.equal(readEnvironment(directory, { NODE_ENV: 'test' }).VALUE, 'environment-local');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('production environment ignores local files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vortexa-env-'));
  try {
    writeFileSync(join(directory, '.env'), 'LOCAL_SECRET=must-not-load\n');
    assert.equal(readEnvironment(directory, { NODE_ENV: 'production' }).LOCAL_SECRET, undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('configuration accepts valid Sepolia deployment', () =>
  assert.equal(loadConfig(env, manifest).contracts.ZAP, addr));
test('configuration rejects wrong chain', () =>
  assert.throws(() => loadConfig({ ...env, CHAIN_ID: '1' }, manifest)));
test('configuration enforces Sepolia-only single-chain runtime controls', () => {
  assert.throws(() => loadConfig({ ...env, BLOCKCHAIN_MODE: 'multi-chain' }, manifest));
  assert.throws(() => loadConfig({ ...env, ACTIVE_CHAIN_IDS: '11155111,1' }, manifest));
  assert.throws(() => loadConfig({ ...env, DEFAULT_CHAIN_ID: '1' }, manifest));
  const config = loadConfig(
    {
      ...env,
      BLOCKCHAIN_MODE: 'single-chain',
      ACTIVE_CHAIN_IDS: '11155111',
      DEFAULT_CHAIN_ID: '11155111',
    },
    manifest,
  );
  assert.deepEqual(config.activeChainIds, [11155111]);
});
test('configuration requires valid environment contract addresses', () => {
  assert.throws(() => loadConfig({ ...env, CONTRACT_ZAP: '' }, manifest));
  assert.throws(() => loadConfig({ ...env, CONTRACT_ZAP: 'not-an-address' }, manifest));
});
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
