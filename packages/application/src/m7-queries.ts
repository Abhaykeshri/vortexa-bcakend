import { Buffer } from 'node:buffer';
import type { CachePort, ChainStatePort, VaultCatalogRepositoryPort } from '../../domain/src/ports.js';
import type {
  Address,
  ChainId,
  PositionListCursor,
  ProjectionState,
  VaultEventCursor,
  VaultListCursor,
  VaultProjection,
  VaultProjectionEvent,
  WalletVaultPosition,
} from '../../domain/src/types.js';

export class InvalidPaginationCursorError extends Error {
  constructor() {
    super('Invalid pagination cursor');
    this.name = 'InvalidPaginationCursorError';
  }
}

export class ProjectionUnavailableError extends Error {
  constructor() {
    super('M7 projection is unavailable');
    this.name = 'ProjectionUnavailableError';
  }
}

type CursorEnvelope = {
  route: string;
  chainId: number;
  generation: string;
  snapshotBlock: string;
  key: Record<string, string | number>;
};

function encodeCursor(value: CursorEnvelope): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(
  encoded: string,
  route: string,
  chainId: ChainId,
  state: ProjectionState,
): CursorEnvelope {
  try {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(encoded)) throw new Error('invalid encoding');
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid payload');
    const cursor = parsed as Partial<CursorEnvelope>;
    if (
      cursor.route !== route ||
      cursor.chainId !== chainId ||
      cursor.generation !== state.generation.toString() ||
      cursor.snapshotBlock !== state.indexedThroughBlock.toString() ||
      !cursor.key ||
      typeof cursor.key !== 'object'
    )
      throw new Error('cursor scope mismatch');
    return cursor as CursorEnvelope;
  } catch {
    throw new InvalidPaginationCursorError();
  }
}

function safeRouteSegment(value: string): string {
  if (!/^[a-z0-9._-]{1,240}$/.test(value)) throw new Error('Invalid cache route scope');
  return value;
}

function cursorDecimal(value: string | number | undefined): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value))
    throw new InvalidPaginationCursorError();
  return BigInt(value);
}

function cursorIndex(value: string | number | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new InvalidPaginationCursorError();
  return value;
}

function cursorAddress(value: string | number | undefined): Address {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new InvalidPaginationCursorError();
  return value as Address;
}

export function buildResponseCacheKey(input: {
  routeName: string;
  chainId: ChainId;
  resourceScope: string;
  generation: bigint;
  cursor: string | null;
  limit: number;
}): string {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100)
    throw new Error('Invalid cache limit');
  const route = safeRouteSegment(
    `${input.routeName}.chain_${input.chainId}.${input.resourceScope}.scope_public`,
  );
  const version = `v1.g${input.generation}`;
  const cursor = input.cursor ?? 'start';
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(cursor) && cursor !== 'start') throw new InvalidPaginationCursorError();
  return `${route}:${version}:${cursor}:${String(input.limit)}`;
}

export interface M7ResponseMeta {
  chainId: ChainId;
  snapshotBlock: string;
  indexedThroughBlock: string;
  indexedBlockHash: `0x${string}`;
  finality: ProjectionState['finality'];
  stale: boolean;
  generation: string;
}

export interface M7Page<T> {
  data: readonly T[];
  nextCursor: string | null;
  meta: M7ResponseMeta;
}

type SerializedVault = ReturnType<typeof serializeVault>;
type SerializedEvent = ReturnType<typeof serializeEvent>;
type SerializedPosition = ReturnType<typeof serializePosition>;

function serializeVault(vault: VaultProjection) {
  return {
    chainId: vault.chainId,
    address: vault.address,
    factoryAddress: vault.factoryAddress,
    creator: vault.creator,
    creationTransactionHash: vault.creationTransactionHash,
    creationBlock: vault.creationBlock.toString(),
    poolId: vault.poolId,
    strategy: vault.strategy,
    strategyContract: vault.strategyContract,
    shapeId: vault.shapeId,
    config: vault.config,
    totalShares: vault.totalShares.toString(),
    totalAssets: vault.totalAssets?.toString() ?? null,
    totalAssets0: vault.totalAssets0?.toString() ?? null,
    totalAssets1: vault.totalAssets1?.toString() ?? null,
    accountingAvailable: vault.accountingAvailable,
    finality: vault.finality,
    indexedThroughBlock: vault.indexedThroughBlock.toString(),
    indexedBlockHash: vault.indexedBlockHash,
  };
}

function serializeEvent(event: VaultProjectionEvent) {
  return {
    chainId: event.chainId,
    blockNumber: event.blockNumber.toString(),
    blockHash: event.blockHash,
    transactionHash: event.transactionHash,
    transactionIndex: event.transactionIndex,
    logIndex: event.logIndex,
    address: event.address,
    eventName: event.eventName,
    eventArgs: event.eventArgs,
    finality: event.finality,
  };
}

function serializePosition(position: WalletVaultPosition) {
  return {
    chainId: position.chainId,
    vaultAddress: position.vaultAddress,
    walletAddress: position.walletAddress,
    shares: position.shares.toString(),
    amount0: position.amount0?.toString() ?? null,
    amount1: position.amount1?.toString() ?? null,
    accountingAvailable: position.accountingAvailable,
    finality: position.finality,
    asOfBlock: position.asOfBlock.toString(),
    indexedBlockHash: position.indexedBlockHash,
  };
}

export interface LatestBlockPort extends ChainStatePort {
  latestBlock(): Promise<bigint>;
}

export class M7QueryService {
  constructor(
    private readonly repository: VaultCatalogRepositoryPort,
    private readonly chain: LatestBlockPort,
    private readonly cache: CachePort | undefined,
    private readonly staleAfterBlocks: number,
    private readonly ttls: { vaults: number; detail: number; events: number; positions: number },
  ) {}

  private async state(chainId: ChainId): Promise<ProjectionState> {
    const state = await this.repository.projectionState(chainId);
    if (!state) throw new ProjectionUnavailableError();
    return state;
  }

  private async meta(chainId: ChainId, state: ProjectionState): Promise<M7ResponseMeta> {
    const latest = await this.chain.latestBlock().catch(() => null);
    const stale =
      latest === null ||
      latest > state.indexedThroughBlock + BigInt(this.staleAfterBlocks) ||
      state.finality === 'OBSERVED';
    return {
      chainId,
      snapshotBlock: state.indexedThroughBlock.toString(),
      indexedThroughBlock: state.indexedThroughBlock.toString(),
      indexedBlockHash: state.indexedBlockHash,
      finality: state.finality,
      stale,
      generation: state.generation.toString(),
    };
  }

  private async cached<T>(key: string): Promise<T | null> {
    if (!this.cache) return null;
    try {
      return await this.cache.get<T>(key);
    } catch {
      return null;
    }
  }

  private async storeCache(key: string, value: unknown, ttl: number): Promise<void> {
    if (!this.cache) return;
    try {
      await this.cache.set(key, value, ttl);
    } catch {
      // PostgreSQL is authoritative; response caching is optional.
    }
  }

  async listVaults(
    chainId: ChainId,
    cursorValue: string | null,
    limit: number,
  ): Promise<M7Page<SerializedVault>> {
    const state = await this.state(chainId);
    const route = 'vaults';
    const cursor = cursorValue ? decodeCursor(cursorValue, route, chainId, state) : null;
    const key = buildResponseCacheKey({
      routeName: route,
      chainId,
      resourceScope: 'filters_none',
      generation: state.generation,
      cursor: cursorValue,
      limit,
    });
    const hit = await this.cached<Omit<M7Page<SerializedVault>, 'meta'>>(key);
    if (hit) return { ...hit, meta: await this.meta(chainId, state) };
    const pageCursor: VaultListCursor | null = cursor
      ? {
          creationBlock: cursorDecimal(cursor.key.creationBlock),
          address: cursorAddress(cursor.key.address),
        }
      : null;
    const rows = await this.repository.listVaults(chainId, state.indexedThroughBlock, pageCursor, limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor({
            route,
            chainId,
            generation: state.generation.toString(),
            snapshotBlock: state.indexedThroughBlock.toString(),
            key: { creationBlock: last.creationBlock.toString(), address: last.address },
          })
        : null;
    const cacheValue = { data: page.map(serializeVault), nextCursor };
    await this.storeCache(key, cacheValue, this.ttls.vaults);
    return { ...cacheValue, meta: await this.meta(chainId, state) };
  }

  async vaultDetail(
    chainId: ChainId,
    address: Address,
  ): Promise<{
    data: SerializedVault | null;
    meta: M7ResponseMeta;
  }> {
    const state = await this.state(chainId);
    const key = buildResponseCacheKey({
      routeName: 'vault_detail',
      chainId,
      resourceScope: `vault_${address.toLowerCase()}`,
      generation: state.generation,
      cursor: null,
      limit: 1,
    });
    const hit = await this.cached<{ data: SerializedVault | null }>(key);
    if (hit) return { ...hit, meta: await this.meta(chainId, state) };
    const vault = await this.repository.findVault(chainId, address);
    const cacheValue = { data: vault ? serializeVault(vault) : null };
    if (vault) await this.storeCache(key, cacheValue, this.ttls.detail);
    return { ...cacheValue, meta: await this.meta(chainId, state) };
  }

  async vaultEvents(
    chainId: ChainId,
    address: Address,
    cursorValue: string | null,
    limit: number,
  ): Promise<M7Page<SerializedEvent>> {
    const state = await this.state(chainId);
    const route = 'vault_events';
    const cursor = cursorValue ? decodeCursor(cursorValue, route, chainId, state) : null;
    const key = buildResponseCacheKey({
      routeName: route,
      chainId,
      resourceScope: `vault_${address.toLowerCase()}`,
      generation: state.generation,
      cursor: cursorValue,
      limit,
    });
    const hit = await this.cached<Omit<M7Page<SerializedEvent>, 'meta'>>(key);
    if (hit) return { ...hit, meta: await this.meta(chainId, state) };
    const pageCursor: VaultEventCursor | null = cursor
      ? {
          blockNumber: cursorDecimal(cursor.key.blockNumber),
          transactionIndex: cursorIndex(cursor.key.transactionIndex),
          logIndex: cursorIndex(cursor.key.logIndex),
        }
      : null;
    const rows = await this.repository.listVaultEvents(
      chainId,
      address,
      state.indexedThroughBlock,
      pageCursor,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor({
            route,
            chainId,
            generation: state.generation.toString(),
            snapshotBlock: state.indexedThroughBlock.toString(),
            key: {
              blockNumber: last.blockNumber.toString(),
              transactionIndex: last.transactionIndex,
              logIndex: last.logIndex,
            },
          })
        : null;
    const cacheValue = { data: page.map(serializeEvent), nextCursor };
    await this.storeCache(key, cacheValue, this.ttls.events);
    return { ...cacheValue, meta: await this.meta(chainId, state) };
  }

  async walletPositions(
    chainId: ChainId,
    wallet: Address,
    cursorValue: string | null,
    limit: number,
  ): Promise<M7Page<SerializedPosition>> {
    const state = await this.state(chainId);
    const route = 'wallet_positions';
    const cursor = cursorValue ? decodeCursor(cursorValue, route, chainId, state) : null;
    const key = buildResponseCacheKey({
      routeName: route,
      chainId,
      resourceScope: `wallet_${wallet.toLowerCase()}`,
      generation: state.generation,
      cursor: cursorValue,
      limit,
    });
    const hit = await this.cached<Omit<M7Page<SerializedPosition>, 'meta'>>(key);
    if (hit) return { ...hit, meta: await this.meta(chainId, state) };
    const pageCursor: PositionListCursor | null = cursor
      ? { vaultAddress: cursorAddress(cursor.key.vaultAddress) }
      : null;
    const rows = await this.repository.listWalletPositions(
      chainId,
      wallet,
      state.indexedThroughBlock,
      pageCursor,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor({
            route,
            chainId,
            generation: state.generation.toString(),
            snapshotBlock: state.indexedThroughBlock.toString(),
            key: { vaultAddress: last.vaultAddress },
          })
        : null;
    const cacheValue = { data: page.map(serializePosition), nextCursor };
    await this.storeCache(key, cacheValue, this.ttls.positions);
    return { ...cacheValue, meta: await this.meta(chainId, state) };
  }
}
