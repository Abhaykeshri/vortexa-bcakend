import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDotEnv, readEnvironment, loadConfig, publicConfig } from '../apps/api/src/config/env.js';
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
    AUTOMATION_TANK: { name: 'AutomationTank' },
    VAULT_M6_MODULE: { name: 'VaultM6Module' },
    VAULT_M5_MODULE: { name: 'VaultM5Module' },
  },
} as DeploymentManifest;
const env: Record<string, string> = {
  NODE_ENV: 'test',
  ACTIVE_CHAIN_ID: '11155111',
  SEPOLIA_RPC_URL: 'https://rpc.example.org',
  ...Object.fromEntries(Object.keys(manifest.contracts).map((key) => [`CONTRACT_${key}`, addr])),
};
test('dotenv parser supports comments and quoted values', () => {
  assert.equal(
    JSON.stringify(parseDotEnv('# hi\nFOO="bar"\nX=hello\n')),
    JSON.stringify({ FOO: 'bar', X: 'hello' }),
  );
});
test('environment loader reads only .env and lets process variables override it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vortexa-env-'));
  try {
    writeFileSync(join(directory, '.env'), 'VALUE=base\nBASE_ONLY=yes\n');
    writeFileSync(join(directory, '.env.test'), 'VALUE=environment\n');
    writeFileSync(join(directory, '.env.local'), 'VALUE=local\n');
    writeFileSync(join(directory, '.env.test.local'), 'VALUE=environment-local\n');
    const loaded = readEnvironment(directory, { NODE_ENV: 'test', VALUE: 'process' });
    assert.equal(loaded.VALUE, 'process');
    assert.equal(loaded.BASE_ONLY, 'yes');
    assert.equal(readEnvironment(directory, { NODE_ENV: 'test' }).VALUE, 'base');
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
  assert.throws(() => loadConfig({ ...env, ACTIVE_CHAIN_ID: '1' }, manifest)));
test('configuration accepts one active Sepolia chain ID', () => {
  const config = loadConfig(env, manifest);
  assert.equal(config.chainId, 11155111);
  assert.deepEqual(publicConfig(config), {
    chainId: 11155111,
    activeChainIds: [11155111],
    defaultChainId: 11155111,
    blockchainMode: 'single-chain',
    manifestVersion: 'test-v1',
    contracts: config.contracts,
    confirmations: 12,
  });
});
test('one global rate limit retains stricter chain and contract endpoint caps', () => {
  const config = loadConfig({ ...env, GLOBAL_RATE_LIMIT: '60' }, manifest);
  assert.deepEqual(
    [config.networkRateLimit, config.chainRateLimit, config.contractStatusRateLimit],
    [60, 30, 10],
  );
  const strictConfig = loadConfig({ ...env, GLOBAL_RATE_LIMIT: '5' }, manifest);
  assert.deepEqual(
    [strictConfig.networkRateLimit, strictConfig.chainRateLimit, strictConfig.contractStatusRateLimit],
    [5, 5, 5],
  );
});
test('configuration requires valid environment contract addresses', () => {
  assert.throws(() => loadConfig({ ...env, CONTRACT_ZAP: '' }, manifest));
  assert.throws(() => loadConfig({ ...env, CONTRACT_ZAP: 'not-an-address' }, manifest));
});
test('pagination, cache TTL, rate limits and multiple CORS origins are validated', () => {
  const config = loadConfig(
    {
      ...env,
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173',
      M7_PAGE_DEFAULT: '20',
      M7_PAGE_MAX: '40',
      M7_VAULT_LIST_CACHE_TTL_SECONDS: '21',
      M7_READ_RATE_LIMIT: '17',
    },
    manifest,
  );
  assert.deepEqual(config.corsAllowedOrigins, ['http://localhost:5173', 'http://127.0.0.1:5173']);
  assert.equal(config.m7PageDefault, 20);
  assert.equal(config.m7PageMax, 40);
  assert.equal(config.m7VaultListCacheTtlSeconds, 21);
  assert.equal(config.m7ReadRateLimit, 17);
  assert.throws(() => loadConfig({ ...env, M7_PAGE_DEFAULT: '51', M7_PAGE_MAX: '50' }, manifest));
  assert.throws(() => loadConfig({ ...env, M7_VAULT_LIST_CACHE_TTL_SECONDS: '0' }, manifest));
  assert.throws(() => loadConfig({ ...env, M7_READ_RATE_LIMIT: '0' }, manifest));
  assert.throws(() => loadConfig({ ...env, CORS_ALLOWED_ORIGINS: 'null' }, manifest));
});
test('PostgreSQL and Redis URL schemes fail closed', () => {
  assert.throws(() => loadConfig({ ...env, DATABASE_URL: 'https://database.example' }, manifest));
  assert.throws(() => loadConfig({ ...env, REDIS_URL: 'https://redis.example' }, manifest));
});
test('configuration rejects missing RPC', () =>
  assert.throws(() => loadConfig({ ...env, SEPOLIA_RPC_URL: '' }, manifest)));
test('indexer configuration requires explicit finality, recovery, persistence and worker identity', () => {
  assert.throws(() => loadConfig({ ...env, INDEXER_ENABLED: 'true' }, manifest));
  const config = loadConfig(
    {
      ...env,
      INDEXER_ENABLED: 'true',
      INDEXER_START_BLOCK: '12032363',
      INDEXER_BATCH_SIZE: '500',
      INDEXER_POLL_INTERVAL_MS: '12000',
      INDEXER_CONFIRMATIONS: '12',
      INDEXER_MAX_REORG_DEPTH: '64',
      INDEXER_WORKER_ID: 'test-indexer-1',
      DATABASE_URL: 'postgresql://database.example/vortexa',
      REDIS_URL: 'redis://redis.example',
    },
    manifest,
  );
  assert.equal(config.indexerChainId, config.chainId);
  assert.equal(config.indexerStartBlock, 12032363n);
  assert.equal(config.indexerMaxReorgDepth, 64);
});
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
test('RPC adapter rejects malformed responses, provider limits and bounded timeouts', async () => {
  const malformed = new JsonRpcHttpAdapter(
    'https://example.org',
    100,
    0,
    async () => new Response('null', { status: 200 }),
  );
  await assert.rejects(() => malformed.request('eth_chainId'), /RPC unavailable/);
  const limited = new JsonRpcHttpAdapter(
    'https://example.org',
    100,
    0,
    async () => new Response('rate limited', { status: 429 }),
  );
  await assert.rejects(() => limited.request('eth_chainId'), /RPC unavailable/);
  const timeout = new JsonRpcHttpAdapter(
    'https://example.org',
    10,
    0,
    async (_url, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
  );
  await assert.rejects(() => timeout.request('eth_chainId'), /RPC unavailable/);
});
