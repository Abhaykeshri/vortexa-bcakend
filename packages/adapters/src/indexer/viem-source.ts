import { readFileSync } from 'node:fs';
import { createPublicClient, decodeEventLog, fallback, getAddress, http, type Abi, type Address } from 'viem';
import { defineChain } from 'viem';
import type { ChainId } from '../../../domain/src/types.js';
import type { ChainHeads, IndexedLog, IndexerSource } from '../../../application/src/indexer.js';

export function isBlockRangeLimitError(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length && seen.size < 32) {
    const value = pending.pop();
    if (typeof value === 'string') {
      if (
        /\b(?:block|log|query)\s+range\b.{0,100}\b(?:limit(?:ed)?|max(?:imum)?|exceed|too large|too wide|more than)\b/i.test(
          value,
        ) ||
        /\b(?:max(?:imum)?|limit)\b.{0,100}\b(?:block|log)\s+range\b/i.test(value) ||
        /\b(?:too many|returned more than)\b.{0,100}\b(?:logs|results)\b/i.test(value) ||
        /\b(?:response|result) size\b.{0,100}\b(?:limit|max(?:imum)?|exceed|too large)\b/i.test(value)
      )
        return true;
      continue;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const record = value as Record<string, unknown>;
    if (
      record.status === 413 ||
      record.code === 413 ||
      record.code === -32005 ||
      record.code === -32602 ||
      record.name === 'InvalidParamsRpcError'
    )
      return true;
    for (const key of ['message', 'shortMessage', 'details', 'cause'])
      if (record[key] !== undefined) pending.push(record[key]);
  }
  return false;
}

function rpcCode(error: unknown): number | string | undefined {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length && seen.size < 16) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const record = value as Record<string, unknown>;
    if (typeof record.code === 'number' || typeof record.code === 'string') return record.code;
    if (record.cause !== undefined) pending.push(record.cause);
  }
  return undefined;
}

export class IndexerRpcOperationError extends Error {
  readonly rpcCode: number | string | undefined;

  constructor(
    readonly operation: 'getBlockNumber' | 'getBlock' | 'getLogs',
    readonly fromBlock: bigint | undefined,
    readonly toBlock: bigint | undefined,
    cause: unknown,
  ) {
    super(`Indexer RPC ${operation} failed`, { cause });
    this.name = 'IndexerRpcOperationError';
    this.rpcCode = rpcCode(cause);
  }
}

export async function fetchLogsByRange<T>(
  fromBlock: bigint,
  toBlock: bigint,
  fetchRange: (from: bigint, to: bigint) => Promise<readonly T[]>,
): Promise<T[]> {
  if (fromBlock < 0n || toBlock < fromBlock) throw new Error('Invalid log range');
  try {
    return [...(await fetchRange(fromBlock, toBlock))];
  } catch (error) {
    if (fromBlock === toBlock || !isBlockRangeLimitError(error)) throw error;
    const middle = (fromBlock + toBlock) / 2n;
    return [
      ...(await fetchLogsByRange(fromBlock, middle, fetchRange)),
      ...(await fetchLogsByRange(middle + 1n, toBlock, fetchRange)),
    ];
  }
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  return value;
}
export class AbiEventDecoder {
  private readonly byAddress = new Map<string, Abi>();
  private readonly vaultAbi: Abi;
  constructor(
    contracts: Readonly<Record<string, Address>>,
    manifest: { contracts: Readonly<Record<string, { name: string }>> },
  ) {
    this.vaultAbi = JSON.parse(
      readFileSync('packages/adapters/abis/Vault.json', 'utf8').replace(/^\uFEFF/, ''),
    ) as Abi;
    for (const [key, address] of Object.entries(contracts)) {
      const name = manifest.contracts[key]?.name;
      if (!name) throw new Error(`Missing ABI metadata: ${key}`);
      const abi = JSON.parse(
        readFileSync(`packages/adapters/abis/${name}.json`, 'utf8').replace(/^\uFEFF/, ''),
      ) as Abi;
      this.byAddress.set(address.toLowerCase(), abi);
    }
  }
  decode(
    address: Address,
    topics: readonly `0x${string}`[],
    data: `0x${string}`,
  ): { eventName?: string; eventArgs?: unknown } {
    // Unknown queried addresses are factory-discovered vaults. The source never
    // queries arbitrary addresses, so the verified Vault ABI is the safe fallback.
    const abi = this.byAddress.get(address.toLowerCase()) ?? this.vaultAbi;
    if (!abi || !topics[0]) return {};
    try {
      const decoded = decodeEventLog({
        abi,
        topics: topics as [`0x${string}`, ...`0x${string}`[]],
        data,
        strict: true,
      });
      if (typeof decoded.eventName !== 'string') return {};
      return { eventName: decoded.eventName, eventArgs: jsonSafe(decoded.args) };
    } catch {
      return {};
    }
  }
}
export class ViemIndexerSource implements IndexerSource {
  private readonly client;
  constructor(
    private readonly chainId: ChainId,
    urls: readonly string[],
    private readonly decoder: AbiEventDecoder,
    private readonly confirmationDepth?: number,
  ) {
    this.client = createPublicClient({
      chain: defineChain({
        id: chainId,
        name: `EVM ${chainId}`,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [...urls] } },
      }),
      transport: fallback(urls.map((url) => http(url, { timeout: 10000, retryCount: 2 }))),
    });
  }
  async verifyChain(chainId: ChainId) {
    if ((await this.client.getChainId()) !== chainId) throw new Error('RPC_CHAIN_MISMATCH');
  }
  async heads(): Promise<ChainHeads> {
    let latest: bigint;
    try {
      latest = await this.client.getBlockNumber();
    } catch (error) {
      throw new IndexerRpcOperationError('getBlockNumber', undefined, undefined, error);
    }
    const safe = await this.client.getBlock({ blockTag: 'safe' }).catch(() => undefined);
    const finalized = await this.client.getBlock({ blockTag: 'finalized' }).catch(() => undefined);
    const confirmed =
      safe?.number ??
      (this.confirmationDepth !== undefined && latest > BigInt(this.confirmationDepth)
        ? latest - BigInt(this.confirmationDepth)
        : undefined);
    return {
      latest,
      ...(confirmed !== undefined ? { confirmed } : {}),
      ...(finalized ? { finalized: finalized.number } : {}),
    };
  }
  async block(number: bigint) {
    let b: Awaited<ReturnType<typeof this.client.getBlock>>;
    try {
      b = await this.client.getBlock({ blockNumber: number });
    } catch (error) {
      throw new IndexerRpcOperationError('getBlock', number, number, error);
    }
    if (!b.hash) throw new Error('RPC_BLOCK_MISSING');
    return { number, hash: b.hash, parentHash: b.parentHash, timestamp: b.timestamp };
  }
  async logs(
    fromBlock: bigint,
    toBlock: bigint,
    addresses: readonly Address[],
  ): Promise<readonly Omit<IndexedLog, 'chainId' | 'finality'>[]> {
    const logs = [];
    try {
      for (const address of new Set(addresses.map(getAddress))) {
        logs.push(
          ...(await fetchLogsByRange(fromBlock, toBlock, (from, to) =>
            this.client.getLogs({
              // Several healthy public RPCs reject address arrays; keep queries address-scoped.
              address,
              fromBlock: from,
              toBlock: to,
            }),
          )),
        );
      }
    } catch (error) {
      if (error instanceof IndexerRpcOperationError) throw error;
      throw new IndexerRpcOperationError('getLogs', fromBlock, toBlock, error);
    }
    return logs.map((l) => {
      if (
        !l.blockHash ||
        l.blockNumber === null ||
        !l.transactionHash ||
        l.transactionIndex === null ||
        l.logIndex === null
      )
        throw new Error('RPC_LOG_INCOMPLETE');
      return {
        transactionHash: l.transactionHash,
        transactionIndex: l.transactionIndex,
        logIndex: l.logIndex,
        blockHash: l.blockHash,
        blockNumber: l.blockNumber,
        address: l.address,
        topics: l.topics,
        data: l.data,
        ...this.decoder.decode(l.address, l.topics, l.data),
      };
    });
  }
}
