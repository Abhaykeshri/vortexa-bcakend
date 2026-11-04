import { createHash } from 'node:crypto';
import type { Address, ChainId } from '../../domain/src/types.js';

export type Finality = 'OBSERVED' | 'CONFIRMED' | 'FINALIZED';
export interface IndexedHeader {
  chainId: ChainId;
  number: bigint;
  hash: `0x${string}`;
  parentHash: `0x${string}`;
  timestamp: bigint;
  finality: Finality;
}
export interface IndexedLog {
  chainId: ChainId;
  transactionHash: `0x${string}`;
  transactionIndex: number;
  logIndex: number;
  blockHash: `0x${string}`;
  blockNumber: bigint;
  address: Address;
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
  eventName?: string;
  eventArgs?: unknown;
  finality: Finality;
}
export interface IndexerCursor {
  blockNumber: bigint;
  blockHash: `0x${string}`;
}
export interface ChainHeads {
  latest: bigint;
  confirmed?: bigint;
  finalized?: bigint;
}
export interface IndexerSource {
  verifyChain(chainId: ChainId): Promise<void>;
  heads(): Promise<ChainHeads>;
  block(number: bigint): Promise<Omit<IndexedHeader, 'chainId' | 'finality'>>;
  logs(
    fromBlock: bigint,
    toBlock: bigint,
    addresses: readonly Address[],
  ): Promise<readonly Omit<IndexedLog, 'chainId' | 'finality'>[]>;
}
export interface SnapshotIndexerSource {
  source: IndexerSource;
  heads: ChainHeads;
}

/** Freezes the source head set so a catch-up run cannot drift while new blocks arrive. */
export async function snapshotIndexerSource(source: IndexerSource): Promise<SnapshotIndexerSource> {
  const heads = await source.heads();
  return {
    heads,
    source: {
      verifyChain: (chainId) => source.verifyChain(chainId),
      heads: async () => heads,
      block: (number) => source.block(number),
      logs: (fromBlock, toBlock, addresses) => source.logs(fromBlock, toBlock, addresses),
    },
  };
}

/** Calculates capped exponential backoff for consecutive indexer failures. */
export function indexerRetryDelay(pollIntervalMs: number, failures: number): number {
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1)
    throw new Error('Invalid indexer poll interval');
  if (!Number.isSafeInteger(failures) || failures < 0) throw new Error('Invalid failure count');
  return Math.min(pollIntervalMs * 2 ** Math.min(failures, 5), 300_000);
}
export interface IndexerStore {
  trackedAddresses?(chainId: ChainId): Promise<readonly Address[]>;
  acquireFence(chainId: ChainId, consumer: string): Promise<bigint>;
  cursor(chainId: ChainId, consumer: string): Promise<IndexerCursor | null>;
  canonicalHeader(chainId: ChainId, blockNumber: bigint): Promise<IndexedHeader | null>;
  commitBatch(
    consumer: string,
    fenceToken: bigint,
    headers: readonly IndexedHeader[],
    logs: readonly IndexedLog[],
  ): Promise<void>;
  rollbackTo(
    chainId: ChainId,
    consumer: string,
    fenceToken: bigint,
    ancestor: IndexedHeader,
    depth: number,
  ): Promise<void>;
  promoteFinality(
    chainId: ChainId,
    consumer: string,
    fenceToken: bigint,
    confirmed?: bigint,
    finalized?: bigint,
  ): Promise<void>;
}

/** Verifies the RPC network before any cursor or projection writes are attempted. */
export async function verifySourceChain(source: IndexerSource, chainId: ChainId): Promise<void> {
  await source.verifyChain(chainId);
}

/** Splits an inclusive block interval into deterministic, bounded RPC ranges. */
export function boundedRanges(from: bigint, to: bigint, size: number): readonly [bigint, bigint][] {
  if (from < 0n || to < from || !Number.isSafeInteger(size) || size < 1)
    throw new Error('Invalid block range');
  const ranges: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += BigInt(size)) {
    const end = start + BigInt(size - 1);
    ranges.push([start, end < to ? end : to]);
  }
  return ranges;
}
/** Waits for a poll delay while allowing shutdown to terminate the wait immediately. */
export function delayOrAbort(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error('Invalid delay duration');
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}
/** Builds the stable on-chain identity used to make event persistence idempotent. */
export function eventIdentity(
  log: Pick<IndexedLog, 'chainId' | 'transactionHash' | 'logIndex' | 'blockHash'>,
): string {
  return `${log.chainId}:${log.transactionHash.toLowerCase()}:${log.logIndex}:${log.blockHash.toLowerCase()}`;
}
/** Classifies a block against the observed confirmed and finalized chain heads. */
export function finalityAt(block: bigint, heads: ChainHeads): Finality {
  if (heads.finalized !== undefined && block <= heads.finalized) return 'FINALIZED';
  if (heads.confirmed !== undefined && block <= heads.confirmed) return 'CONFIRMED';
  return 'OBSERVED';
}
/** Sorts logs into canonical EVM execution order without mutating the caller's array. */
export function orderedLogs<T extends Pick<IndexedLog, 'blockNumber' | 'transactionIndex' | 'logIndex'>>(
  logs: readonly T[],
): T[] {
  return [...logs].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  );
}
/** Produces a deterministic digest used to prove replay equivalence. */
export function logicalStateHash(headers: readonly IndexedHeader[], logs: readonly IndexedLog[]): string {
  const stable = JSON.stringify({
    headers: [...headers]
      .sort((a, b) => (a.number < b.number ? -1 : 1))
      .map((h) => [h.chainId, h.number.toString(), h.hash, h.parentHash, h.finality]),
    logs: orderedLogs(logs).map((l) => [
      eventIdentity(l),
      l.blockNumber.toString(),
      l.address.toLowerCase(),
      l.topics,
      l.data,
      l.eventName ?? null,
      l.eventArgs ?? null,
      l.finality,
    ]),
  });
  return createHash('sha256').update(stable).digest('hex');
}

/**
 * Coordinates bounded log ingestion, reorg detection, atomic cursor commits,
 * and finality promotion through hexagonal source and store ports.
 */
export class BlockchainIndexerService {
  constructor(
    private readonly chainId: ChainId,
    private readonly consumer: string,
    private readonly startBlock: bigint,
    private readonly batchSize: number,
    private readonly maxReorgDepth: number,
    private readonly addresses: readonly Address[],
    private readonly source: IndexerSource,
    private readonly store: IndexerStore,
    private readonly fenceToken: bigint,
    private readonly headerConcurrency = 10,
  ) {}

  private async recover(cursor: IndexerCursor): Promise<void> {
    for (let depth = 0; depth <= this.maxReorgDepth; depth++) {
      const number = cursor.blockNumber - BigInt(depth);
      if (number < this.startBlock) break;
      const [stored, current] = await Promise.all([
        this.store.canonicalHeader(this.chainId, number),
        this.source.block(number),
      ]);
      if (stored && stored.hash.toLowerCase() === current.hash.toLowerCase()) {
        if (depth > 0)
          await this.store.rollbackTo(this.chainId, this.consumer, this.fenceToken, stored, depth);
        return;
      }
    }
    throw new Error('REORG_RECOVERY_LIMIT_EXCEEDED');
  }

  /** Executes one bounded catch-up cycle and returns the processed range and log count. */
  async runOnce(): Promise<{ from?: bigint; to?: bigint; logs: number }> {
    await verifySourceChain(this.source, this.chainId);
    const heads = await this.source.heads();
    let cursor = await this.store.cursor(this.chainId, this.consumer);
    if (cursor) {
      const current = await this.source.block(cursor.blockNumber);
      if (current.hash.toLowerCase() !== cursor.blockHash.toLowerCase()) {
        await this.recover(cursor);
        cursor = await this.store.cursor(this.chainId, this.consumer);
      }
    }
    const from = cursor ? cursor.blockNumber + 1n : this.startBlock;
    if (from > heads.latest) {
      await this.store.promoteFinality(
        this.chainId,
        this.consumer,
        this.fenceToken,
        heads.confirmed,
        heads.finalized,
      );
      return { logs: 0 };
    }
    const to =
      from + BigInt(this.batchSize - 1) < heads.latest ? from + BigInt(this.batchSize - 1) : heads.latest;
    const headers: IndexedHeader[] = [];
    for (const [chunkFrom, chunkTo] of boundedRanges(from, to, this.headerConcurrency)) {
      const blocks = await Promise.all(
        Array.from({ length: Number(chunkTo - chunkFrom + 1n) }, (_, offset) =>
          this.source.block(chunkFrom + BigInt(offset)),
        ),
      );
      for (const block of blocks) {
        const previousHash = headers.at(-1)?.hash ?? cursor?.blockHash;
        if (previousHash && block.parentHash.toLowerCase() !== previousHash.toLowerCase())
          throw new Error('RPC_BLOCK_GAP_OR_REORG');
        headers.push({ ...block, chainId: this.chainId, finality: finalityAt(block.number, heads) });
      }
    }
    const tracked = (await this.store.trackedAddresses?.(this.chainId)) ?? [];
    const requestedAddresses = [
      ...new Set([...this.addresses, ...tracked].map((value) => value.toLowerCase())),
    ].filter((value): value is Address => /^0x[a-f0-9]{40}$/.test(value));
    const initialLogs = await this.source.logs(from, to, requestedAddresses);
    const discovered = initialLogs
      .filter((log) => log.eventName === 'VaultCreated')
      .map((log) =>
        log.eventArgs && typeof log.eventArgs === 'object' && !Array.isArray(log.eventArgs)
          ? (log.eventArgs as Record<string, unknown>).vault
          : undefined,
      )
      .filter(
        (value): value is Address =>
          typeof value === 'string' &&
          /^0x[a-fA-F0-9]{40}$/.test(value) &&
          !requestedAddresses.includes(value.toLowerCase() as Address),
      );
    const discoveredLogs = discovered.length
      ? await this.source.logs(from, to, [
          ...new Set(discovered.map((value) => value.toLowerCase() as Address)),
        ])
      : [];
    const uniqueLogs = new Map(
      [...initialLogs, ...discoveredLogs].map((log) => [
        `${log.transactionHash.toLowerCase()}:${log.logIndex}:${log.blockHash.toLowerCase()}`,
        log,
      ]),
    );
    const logs = orderedLogs([...uniqueLogs.values()]).map((log) => ({
      ...log,
      chainId: this.chainId,
      finality: finalityAt(log.blockNumber, heads),
    }));
    await this.store.commitBatch(this.consumer, this.fenceToken, headers, logs);
    await this.store.promoteFinality(
      this.chainId,
      this.consumer,
      this.fenceToken,
      heads.confirmed,
      heads.finalized,
    );
    return { from, to, logs: logs.length };
  }
}
