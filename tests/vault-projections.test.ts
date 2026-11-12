import test from 'node:test';
import assert from 'node:assert/strict';
import type { CachePort, VaultCatalogRepositoryPort } from '../packages/domain/src/ports.js';
import type {
  Address,
  ChainId,
  PinnedVaultState,
  ProjectionState,
  VaultProjection,
  VaultProjectionEvent,
  WalletVaultPosition,
} from '../packages/domain/src/types.js';
import {
  InvalidPaginationCursorError,
  VaultQueryService,
  buildResponseCacheKey,
} from '../packages/application/src/vault-query.service.js';
import {
  hasPositiveHolderSample,
  proveFinalizedProjectionSnapshot,
  reconcilePositiveHolderAtPinnedBlock,
  reconcilePositionAtPinnedBlock,
  reconcileVaultAtPinnedBlock,
} from '../packages/application/src/projection-reconciliation.service.js';
import { ProjectionRefreshService } from '../packages/application/src/projection-refresh.service.js';
import { parseHttpAddress, parsePagination } from '../apps/api/src/validators/request.validator.js';

const chainId = 11155111 as const;
const address = (digit: string): Address => `0x${digit.repeat(40)}`;
const hash = (digit: string): `0x${string}` => `0x${digit.repeat(64)}`;
const state: ProjectionState = {
  chainId,
  generation: 7n,
  indexedThroughBlock: 100n,
  indexedBlockHash: hash('a'),
  finality: 'FINALIZED',
};
const vault = (id: string, block: bigint): VaultProjection => ({
  chainId,
  address: address(id),
  factoryAddress: address('f'),
  creator: address('c'),
  creationTransactionHash: hash(id),
  creationBlock: block,
  poolId: hash('b'),
  strategy: 'NormalLP',
  strategyContract: address('d'),
  shapeId: 3,
  config: { shapeId: '3' },
  totalShares: 12n,
  totalAssets: 10n,
  totalAssets0: 6n,
  totalAssets1: 4n,
  accountingAvailable: true,
  finality: 'FINALIZED',
  indexedThroughBlock: 100n,
  indexedBlockHash: hash('a'),
});
const position: WalletVaultPosition = {
  chainId,
  vaultAddress: address('1'),
  walletAddress: address('e'),
  shares: 5n,
  amount0: 3n,
  amount1: 2n,
  accountingAvailable: true,
  finality: 'FINALIZED',
  asOfBlock: 100n,
  indexedBlockHash: hash('a'),
};
const event: VaultProjectionEvent = {
  chainId,
  blockNumber: 99n,
  blockHash: hash('9'),
  transactionHash: hash('8'),
  transactionIndex: 1,
  logIndex: 2,
  address: address('1'),
  eventName: 'Transfer',
  eventArgs: { value: '5' },
  finality: 'FINALIZED',
};

class FakeRepository implements VaultCatalogRepositoryPort {
  state: ProjectionState | null = state;
  vaults = [vault('1', 90n), vault('2', 80n)];
  positions = [position];
  events = [event];
  async projectionState() {
    return this.state;
  }
  async listVaults(
    _chain: ChainId,
    _snapshot: bigint,
    cursor: { creationBlock: bigint; address: Address } | null,
    limit: number,
  ) {
    const start = cursor ? this.vaults.findIndex((item) => item.address === cursor.address) + 1 : 0;
    return this.vaults.slice(start, start + limit);
  }
  async findVault(_chain: ChainId, target: Address) {
    return this.vaults.find((item) => item.address === target) ?? null;
  }
  async listVaultEvents() {
    return this.events;
  }
  async listWalletPositions() {
    return this.positions;
  }
  async listVaultHolders() {
    return this.positions;
  }
  async listVaultSnapshots() {
    return [];
  }
}

class FakeCache implements CachePort {
  values = new Map<string, unknown>();
  gets = 0;
  sets = 0;
  ttl = 0;
  fail = false;
  async get<T>(key: string) {
    this.gets++;
    if (this.fail) throw new Error('cache unavailable');
    return (this.values.get(key) as T | undefined) ?? null;
  }
  async set<T>(key: string, value: T, ttlSeconds: number) {
    this.sets++;
    if (this.fail) throw new Error('cache unavailable');
    this.ttl = ttlSeconds;
    this.values.set(key, value);
  }
  async delete(key: string) {
    this.values.delete(key);
  }
}

function service(repository = new FakeRepository(), cache: CachePort | undefined = new FakeCache()) {
  return new VaultQueryService(
    repository,
    { latestBlock: async () => 105n, finalizedBlock: async () => 100n },
    cache,
    10,
    { vaults: 15, detail: 10, events: 10, positions: 5 },
  );
}

test('Response cache keys use four canonical fields and isolate resource, cursor and generation', () => {
  const first = buildResponseCacheKey({
    routeName: 'vaults',
    chainId,
    resourceScope: 'filters_none',
    generation: 1n,
    cursor: null,
    limit: 25,
  });
  assert.equal(first.split(':').length, 4);
  assert.match(first, /^vaults\.chain_11155111\.filters_none\.scope_public:v1\.g1:start:25$/);
  const changed = buildResponseCacheKey({
    routeName: 'vault_detail',
    chainId,
    resourceScope: `vault_${address('1')}`,
    generation: 2n,
    cursor: 'YWJj',
    limit: 1,
  });
  assert.notEqual(first, changed);
  const internal = buildResponseCacheKey({
    routeName: 'vaults',
    chainId,
    resourceScope: 'filters_none',
    visibilityScope: 'internal',
    generation: 1n,
    cursor: null,
    limit: 25,
  });
  assert.match(internal, /\.scope_internal:v1\.g1:start:25$/);
  assert.notEqual(first, internal);
  const scopes = [
    buildResponseCacheKey({
      routeName: 'wallet_positions',
      chainId,
      resourceScope: `wallet_${address('1')}`,
      generation: 1n,
      cursor: null,
      limit: 25,
    }),
    buildResponseCacheKey({
      routeName: 'wallet_positions',
      chainId,
      resourceScope: `wallet_${address('2')}`,
      generation: 1n,
      cursor: null,
      limit: 25,
    }),
    buildResponseCacheKey({
      routeName: 'vault_events',
      chainId,
      resourceScope: `vault_${address('1')}`,
      generation: 1n,
      cursor: 'YWJj',
      limit: 25,
    }),
    buildResponseCacheKey({
      routeName: 'vault_events',
      chainId,
      resourceScope: `vault_${address('1')}`,
      generation: 1n,
      cursor: 'ZGVm',
      limit: 50,
    }),
  ];
  assert.equal(new Set(scopes).size, scopes.length);
});

test('vault list is deterministic, cached with bounded TTL and falls back on cache outage', async () => {
  const cache = new FakeCache();
  const queries = service(new FakeRepository(), cache);
  const first = await queries.listVaults(chainId, null, 1);
  assert.equal(first.data.length, 1);
  assert.ok(first.nextCursor);
  assert.equal(first.meta.stale, false);
  assert.equal(cache.ttl, 15);
  await queries.listVaults(chainId, null, 1);
  assert.equal(cache.sets, 1);
  cache.fail = true;
  const fallback = await queries.vaultDetail(chainId, address('1'));
  assert.equal(fallback.data?.totalShares, '12');
});

test('cursor is scoped to projection generation and stale data is never represented as live', async () => {
  const repository = new FakeRepository();
  const queries = service(repository);
  const first = await queries.listVaults(chainId, null, 1);
  repository.state = { ...state, generation: 8n };
  await assert.rejects(() => queries.listVaults(chainId, first.nextCursor, 1), InvalidPaginationCursorError);
  const staleService = new VaultQueryService(
    repository,
    { latestBlock: async () => 1000n, finalizedBlock: async () => 900n },
    undefined,
    10,
    { vaults: 1, detail: 1, events: 1, positions: 1 },
  );
  assert.equal((await staleService.listVaults(chainId, null, 1)).meta.stale, true);
  const malformedKey = Buffer.from(
    JSON.stringify({
      route: 'vaults',
      chainId,
      generation: '8',
      snapshotBlock: '100',
      key: { creationBlock: '-1', address: address('1') },
    }),
  ).toString('base64url');
  await assert.rejects(() => queries.listVaults(chainId, malformedKey, 1), InvalidPaginationCursorError);
});

test('vault events and wallet positions expose exact decimal strings and availability', async () => {
  const queries = service();
  const events = await queries.vaultEvents(chainId, address('1'), null, 10);
  const positions = await queries.walletPositions(chainId, address('e'), null, 10);
  assert.equal(events.data[0]?.blockNumber, '99');
  assert.equal(positions.data[0]?.shares, '5');
  assert.equal(positions.data[0]?.amount0, '3');
  assert.equal(positions.data[0]?.accountingAvailable, true);
});

test('HTTP validators reject invalid projection query input with stable error codes', () => {
  assert.throws(
    () => parseHttpAddress('not-an-address'),
    (error: unknown) => (error as { code?: string }).code === 'INVALID_ADDRESS',
  );
  assert.throws(
    () => parsePagination({ limit: '500' }, 25, 50),
    (error: unknown) => (error as { code?: string }).code === 'INVALID_LIMIT',
  );
  assert.throws(
    () => parsePagination({ strategy: 'NormalLP' }, 25, 50),
    (error: unknown) => (error as { code?: string }).code === 'INVALID_QUERY',
  );
});

test('vault and wallet APIs return stable empty pages without fabricated rows', async () => {
  const repository = new FakeRepository();
  repository.vaults = [];
  repository.positions = [];
  const queries = service(repository);
  assert.deepEqual(await queries.listVaults(chainId, null, 25).then((page) => page.data), []);
  const wallet = await queries.walletPositions(chainId, address('e'), null, 25);
  assert.deepEqual(wallet.data, []);
  assert.equal(wallet.nextCursor, null);
});

test('pinned-block parity detects vault and holder discrepancies', () => {
  const projected = vault('1', 90n);
  const pinned: PinnedVaultState = {
    vaultAddress: projected.address,
    blockNumber: 100n,
    blockHash: hash('a'),
    strategyContract: projected.strategyContract,
    config: projected.config!,
    totalShares: projected.totalShares,
    totalAssets: projected.totalAssets!,
    totalAssets0: projected.totalAssets0,
    totalAssets1: projected.totalAssets1,
    accountingAvailable: true,
  };
  assert.equal(reconcileVaultAtPinnedBlock(projected, pinned).passed, true);
  assert.deepEqual(reconcileVaultAtPinnedBlock({ ...projected, totalShares: 13n }, pinned).mismatches, [
    'SHARE_SUPPLY',
  ]);
  assert.equal(
    reconcilePositionAtPinnedBlock(position, {
      vaultAddress: position.vaultAddress,
      walletAddress: position.walletAddress,
      blockNumber: 100n,
      shares: 5n,
      amount0: 3n,
      amount1: 2n,
      accountingAvailable: true,
    }).passed,
    true,
  );
});

test('live verifier proves finality from the canonical chain instead of a stale database label', () => {
  const observedState: ProjectionState = { ...state, finality: 'OBSERVED' };
  const projected = { ...vault('1', 90n), finality: 'OBSERVED' as const };
  assert.equal(proveFinalizedProjectionSnapshot(observedState, 100n, hash('a')).passed, true);
  assert.deepEqual(proveFinalizedProjectionSnapshot(observedState, 99n, hash('a')).mismatches, [
    'SNAPSHOT_NOT_FINALIZED',
  ]);
  assert.deepEqual(proveFinalizedProjectionSnapshot(observedState, 100n, hash('b')).mismatches, [
    'CANONICAL_BLOCK_HASH',
  ]);
  assert.deepEqual(proveFinalizedProjectionSnapshot(observedState, undefined, hash('a')).mismatches, [
    'FINALIZED_HEAD_UNAVAILABLE',
  ]);
  const pinned: PinnedVaultState = {
    vaultAddress: projected.address,
    blockNumber: 100n,
    blockHash: hash('a'),
    strategyContract: projected.strategyContract,
    config: projected.config!,
    totalShares: projected.totalShares,
    totalAssets: projected.totalAssets!,
    totalAssets0: projected.totalAssets0,
    totalAssets1: projected.totalAssets1,
    accountingAvailable: true,
  };
  assert.equal(reconcileVaultAtPinnedBlock(projected, pinned).passed, false);
  assert.equal(reconcileVaultAtPinnedBlock(projected, pinned, true).passed, true);
});

test('live verifier requires a reconciled positive holder balance', () => {
  assert.equal(hasPositiveHolderSample([]), false);
  assert.equal(hasPositiveHolderSample([{ ...position, shares: 0n }]), false);
  assert.equal(hasPositiveHolderSample([position]), true);
  const pinned = {
    vaultAddress: position.vaultAddress,
    walletAddress: position.walletAddress,
    blockNumber: position.asOfBlock,
    shares: position.shares,
    amount0: position.amount0,
    amount1: position.amount1,
    accountingAvailable: position.accountingAvailable,
  };
  assert.equal(reconcilePositiveHolderAtPinnedBlock(position, pinned, true).passed, true);
  assert.deepEqual(
    reconcilePositiveHolderAtPinnedBlock(position, { ...pinned, shares: 6n }, true).mismatches,
    ['HOLDER_SHARES'],
  );
  assert.deepEqual(
    reconcilePositiveHolderAtPinnedBlock(position, { ...pinned, amount0: 4n }, true).mismatches,
    ['TOKEN0_EXPOSURE'],
  );
  assert.deepEqual(
    reconcilePositiveHolderAtPinnedBlock(position, { ...pinned, amount1: 3n }, true).mismatches,
    ['TOKEN1_EXPOSURE'],
  );
  assert.deepEqual(
    reconcilePositiveHolderAtPinnedBlock({ ...position, shares: 0n }, { ...pinned, shares: 0n }, true)
      .mismatches,
    ['POSITIVE_HOLDER_BALANCE'],
  );
});

test('projection refresher pins vault and holder reads to one canonical block', async () => {
  const repository = new FakeRepository();
  const writes: unknown[] = [];
  const refresher = new ProjectionRefreshService(
    chainId,
    repository,
    {
      vaultState: async (_chain, target, blockNumber) => ({
        vaultAddress: target,
        blockNumber,
        blockHash: hash('a'),
        strategyContract: address('d'),
        config: { shapeId: '3' },
        totalShares: 12n,
        totalAssets: 10n,
        totalAssets0: 6n,
        totalAssets1: 4n,
        accountingAvailable: true,
      }),
      walletPosition: async (_chain, target, wallet, blockNumber) => ({
        vaultAddress: target,
        walletAddress: wallet,
        blockNumber,
        shares: 5n,
        amount0: 3n,
        amount1: 2n,
        accountingAvailable: true,
      }),
    },
    { savePinnedSnapshot: async (input) => void writes.push(input) },
  );
  assert.deepEqual(await refresher.refreshAt(100n), { vaults: 2, positions: 2 });
  assert.equal(writes.length, 1);
});
