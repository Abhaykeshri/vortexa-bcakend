import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config/env.js';
import { openApiDocument } from '../apps/api/src/openapi.js';
import type { ApiDependencies } from '../apps/api/src/api-dependencies.js';
import { VaultUiService } from '../packages/application/src/vault-ui.service.js';
import type { VaultQueryService } from '../packages/application/src/vault-query.service.js';
import { DomainError } from '../packages/domain/src/errors.js';
import { loadManifest } from '../packages/contracts/src/manifest.js';
import type { VaultUiChainPort } from '../packages/domain/src/ports.js';
import type { TransactionPlan, VaultConfigInput } from '../packages/domain/src/vault-ui.js';
import { validateVaultConfig } from '../packages/domain/src/vault-ui.js';

const manifest = loadManifest();
const address = (digit: string): `0x${string}` => `0x${digit.repeat(40)}`;
const hash = (digit: string): `0x${string}` => `0x${digit.repeat(64)}`;
const contracts = Object.fromEntries(
  Object.keys(manifest.contracts).map((key) => [`CONTRACT_${key}`, address('1')]),
);
const config = loadConfig(
  {
    NODE_ENV: 'test',
    ...contracts,
    SEPOLIA_RPC_URL: 'https://rpc.example.org',
    CORS_ALLOWED_ORIGINS: 'https://app.example.org',
    INTERNAL_API_KEY: 'test-internal-key-with-at-least-32-characters',
  },
  manifest,
);

const poolKey = {
  currency0: address('0'),
  currency1: address('2'),
  fee: 500,
  tickSpacing: 20,
  hooks: address('0'),
} as const;

const vaultConfig: VaultConfigInput = {
  poolKey,
  strategy: 0,
  shapeId: 3,
  centerTick: -200000,
  ticksLeft: 2000,
  ticksRight: 2000,
  driftTicks: 0,
  trailTicks: 0,
  autoRebalance: true,
  lockOnFill: false,
  depositCap: 1_000_000n,
  baseIsCurrency0: true,
  triggerTicksDown: 0,
  triggerTicksUp: 0,
  rebalanceMethod: 0,
  limitWidthTicks: 0,
  token0WeightBps: 0,
  carpetBps: 0,
};

const plan: TransactionPlan = {
  chainId: 11155111,
  blockNumber: 100n,
  expiresAfterBlock: 102n,
  quote: { expectedShares: 10n, minimumShares: 9n },
  steps: [
    {
      kind: 'call',
      to: address('3'),
      data: '0x1234',
      value: 0n,
      summary: 'Unsigned call',
      simulation: { status: 'PASSED' },
    },
  ],
};

class FakeVaultUiChain implements VaultUiChainPort {
  async listPools() {
    return [
      {
        id: hash('a'),
        key: poolKey,
        label: 'ETH / TEST',
        allowed: true,
        baseIsCurrency0: true,
        maxDepositCap: 1_000_000n,
        priceTrusted: true,
        priceDeviationBps: 0n,
        referenceSqrtPriceX96: 1n,
        token0: { address: address('0'), symbol: 'ETH', decimals: 18 },
        token1: { address: address('2'), symbol: 'TEST', decimals: 6 },
      },
    ];
  }
  async listShapes() {
    return [{ id: 3, valid: true }];
  }
  async previewShape() {
    return { bands: [{ tickLower: -10, tickUpper: 10 }], weights: [10_000] };
  }
  async validateConfig(input: VaultConfigInput) {
    return { pool: (await this.listPools())[0]!, violations: validateVaultConfig(input, 1_000_000n) };
  }
  async vaultInfo(vault: `0x${string}`) {
    if (vault.toLowerCase() !== address('3')) throw new DomainError('NOT_FOUND', 'Unknown vault');
    return { bands: [], totalShares: 0n };
  }
  async userPosition(vault: `0x${string}`) {
    if (vault.toLowerCase() !== address('3')) throw new DomainError('NOT_FOUND', 'Unknown vault');
    return { shares: 0n };
  }
  async walletBalances() {
    return { token0: '0', token1: '0', shares: '0', token0Display: '0', token1Display: '0', sharesDisplay: '0' };
  }
  async buildManagerUpdate() { return plan; }
  async buildManagerRebalance() { return plan; }
  async buildCreate() {
    return plan;
  }
  async buildDeposit() {
    return plan;
  }
  async buildWithdraw() {
    return plan;
  }
}

function dependencies(): ApiDependencies {
  const projection = {
    listVaults: async () => ({ data: [], nextCursor: null, meta: projectionMeta }),
    vaultDetail: async () => ({ data: null, meta: projectionMeta }),
    vaultEvents: async () => ({ data: [], nextCursor: null, meta: projectionMeta }),
    walletPositions: async () => ({ data: [], nextCursor: null, meta: projectionMeta }),
  } as unknown as VaultQueryService;
  const ui = new VaultUiService(11155111, new FakeVaultUiChain(), projection);
  return {
    config,
    chain: {
      verifyNetwork: async () => undefined,
      latestBlock: async () => 100n,
      finalizedBlock: async () => 90n,
      inspect: async () => ({}),
    },
    contractReader: {
      runtimeCodeHash: async () => hash('1'),
      read: async () => address('1'),
    },
    contractRegistry: { resolve: () => address('1') },
    vaultUiService: ui,
    limiter: { rateLimit: async (_scope, limit) => ({ allowed: true, remaining: limit - 1 }) },
    checkPostgres: async () => true,
    checkRedis: async () => true,
    log: () => undefined,
  };
}

const projectionMeta = {
  chainId: 11155111 as const,
  snapshotBlock: '90',
  indexedThroughBlock: '90',
  indexedBlockHash: hash('9'),
  finality: 'FINALIZED' as const,
  stale: false,
  generation: '1',
};

test('vault config parity rules reject unsafe geometry and accept a valid base config', () => {
  assert.deepEqual(validateVaultConfig(vaultConfig, 1_000_000n), []);
  assert.ok(validateVaultConfig({ ...vaultConfig, centerTick: -200001 }, 1_000_000n).length > 0);
  assert.ok(validateVaultConfig({ ...vaultConfig, carpetBps: 2501 }, 1_000_000n).length > 0);
});

test('OpenAPI publishes all four screen endpoint groups', () => {
  const paths = openApiDocument.paths ?? {};
  assert.ok(paths['/v1/chains/{chainId}/vaults']);
  assert.ok(paths['/v1/chains/{chainId}/tx/create-vault']);
  assert.ok(paths['/v1/chains/{chainId}/tx/deposit']);
  assert.ok(paths['/v1/chains/{chainId}/tx/withdraw']);
});

test('V2 pool and shape routes serialize bigint values as decimal strings', async () => {
  const app = createApp(dependencies());
  const pools = await request(app).get('/v1/chains/11155111/pools').expect(200);
  const poolsBody = pools.body as { data: Array<{ maxDepositCap: string }> };
  assert.equal(poolsBody.data[0]?.maxDepositCap, '1000000');
  const preview = await request(app)
    .post('/v1/shapes/preview')
    .send({ shapeId: 3, centerTick: 0, ticksLeft: 20, ticksRight: 20, tickSpacing: 20 })
    .expect(200);
  const previewBody = preview.body as { weights: number[] };
  assert.equal(previewBody.weights[0], 10000);
});

test('transaction routes return unsigned plans and never signatures or transaction hashes', async () => {
  const app = createApp(dependencies());
  const body = {
    user: address('4'),
    name: 'Test Vault',
    symbol: 'TVLT',
    config: { ...vaultConfig, depositCap: '1000000' },
  };
  const response = await request(app).post('/v1/chains/11155111/tx/create-vault').send(body).expect(200);
  const responseBody = response.body as {
    steps: Array<{ data: string }>;
    quote: { expectedShares: string };
    signature?: string;
    transactionHash?: string;
  };
  assert.equal(responseBody.steps[0]?.data, '0x1234');
  assert.equal(responseBody.quote.expectedShares, '10');
  assert.equal('signature' in responseBody, false);
  assert.equal('transactionHash' in responseBody, false);
});

test('V2 POST preflight is exact-origin and method restricted', async () => {
  const app = createApp(dependencies());
  const allowed = await request(app)
    .options('/v1/chains/11155111/tx/deposit')
    .set('Origin', 'https://app.example.org')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type')
    .expect(204);
  assert.equal(allowed.headers['access-control-allow-methods'], 'POST');
  await request(app)
    .options('/v1/chains/11155111/tx/deposit')
    .set('Origin', 'https://evil.example.org')
    .set('Access-Control-Request-Method', 'POST')
    .expect(403);
});

test('V2 validators reject unknown fields and unsafe slippage', async () => {
  const app = createApp(dependencies());
  await request(app)
    .post('/v1/chains/11155111/quotes/deposit')
    .send({
      mode: 'zapSingle',
      vault: address('3'),
      user: address('4'),
      receiver: address('4'),
      tokenIn: address('2'),
      amountIn: '1',
      toleranceBps: 50,
      swapSlippageBps: 101,
      injected: true,
    })
    .expect(400, /INVALID_INPUT/);
});

test('all six parameterized V2 GET routes accept valid route parameters', async () => {
  const app = createApp(dependencies());
  const vault = address('3');
  const wallet = address('4');
  const paths = [
    `/v1/chains/11155111/vaults/${vault}?user=${wallet}`,
    `/v1/chains/11155111/vaults/${vault}/bands`,
    `/v1/chains/11155111/vaults/${vault}/activity?limit=25`,
    `/v1/chains/11155111/vaults/${vault}/history`,
    `/v1/chains/11155111/vaults/${vault}/rebalances`,
    `/v1/chains/11155111/users/${wallet}/positions?limit=25`,
  ];
  for (const path of paths) await request(app).get(path).expect(200);
});

test('vault-scoped V2 GET routes return 404 for an unregistered vault', async () => {
  const app = createApp(dependencies());
  const vault = address('8');
  const paths = [
    `/v1/chains/11155111/vaults/${vault}`,
    `/v1/chains/11155111/vaults/${vault}/bands`,
    `/v1/chains/11155111/vaults/${vault}/activity`,
    `/v1/chains/11155111/vaults/${vault}/history`,
    `/v1/chains/11155111/vaults/${vault}/rebalances`,
  ];
  for (const path of paths)
    await request(app)
      .get(path)
      .expect(404, /NOT_FOUND/);
});

test('parameterized V2 GET routes preserve malformed-address and unsupported-chain rejection', async () => {
  const app = createApp(dependencies());
  await request(app)
    .get('/v1/chains/11155111/vaults/not-an-address')
    .expect(400, /INVALID_INPUT/);
  await request(app)
    .get(`/v1/chains/1/users/${address('4')}/positions`)
    .expect(400, /INVALID_INPUT/);
});
