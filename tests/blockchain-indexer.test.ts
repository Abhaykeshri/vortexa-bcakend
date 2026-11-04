import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeEventTopics } from 'viem';
import {
  AbiEventDecoder,
  IndexerRpcOperationError,
  fetchLogsByRange,
  isBlockRangeLimitError,
} from '../packages/adapters/src/indexer/viem-indexer-source.adapter.js';
import {
  BlockchainIndexerService,
  boundedRanges,
  delayOrAbort,
  eventIdentity,
  finalityAt,
  indexerRetryDelay,
  logicalStateHash,
  orderedLogs,
  snapshotIndexerSource,
  verifySourceChain,
  type IndexedHeader,
  type IndexedLog,
  type IndexerCursor,
  type IndexerSource,
  type IndexerStore,
} from '../packages/application/src/blockchain-indexer.service.js';
const chainId = 11155111 as const;
const address = `0x${'1'.repeat(40)}` as const;
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as const;
test('poll delay ends promptly when shutdown is requested', { timeout: 1000 }, async () => {
  const controller = new AbortController();
  const waiting = delayOrAbort(60_000, controller.signal);
  setTimeout(() => controller.abort(), 10);
  await waiting;
  assert.equal(controller.signal.aborted, true);
});
test('indexer retry delay retains capped exponential backoff', () => {
  assert.equal(indexerRetryDelay(1000, 0), 1000);
  assert.equal(indexerRetryDelay(1000, 1), 2000);
  assert.equal(indexerRetryDelay(1000, 5), 32_000);
  assert.equal(indexerRetryDelay(12_000, 5), 300_000);
  assert.throws(() => indexerRetryDelay(0, 1), /Invalid indexer poll interval/);
});
class MemoryStore implements IndexerStore {
  headers = new Map<bigint, IndexedHeader>();
  logs = new Map<string, IndexedLog>();
  current: IndexerCursor | null = null;
  rollbacks = 0;
  failCommit = false;
  finalityPromotions: { confirmed?: bigint; finalized?: bigint }[] = [];
  tracked: `0x${string}`[] = [];
  async acquireFence() {
    return 1n;
  }
  async cursor() {
    return this.current;
  }
  async canonicalHeader(_c: typeof chainId, n: bigint) {
    return this.headers.get(n) ?? null;
  }
  async trackedAddresses() {
    return this.tracked;
  }
  async commitBatch(
    _consumer: string,
    _fenceToken: bigint,
    headers: readonly IndexedHeader[],
    logs: readonly IndexedLog[],
  ) {
    if (this.failCommit) throw new Error('crash');
    const nextHeaders = new Map(this.headers);
    const nextLogs = new Map(this.logs);
    for (const h of headers) nextHeaders.set(h.number, h);
    for (const l of logs) nextLogs.set(eventIdentity(l), l);
    this.headers = nextHeaders;
    this.logs = nextLogs;
    const last = headers.at(-1)!;
    this.current = { blockNumber: last.number, blockHash: last.hash };
  }
  async rollbackTo(_c: typeof chainId, _consumer: string, _fenceToken: bigint, ancestor: IndexedHeader) {
    for (const n of [...this.headers.keys()]) if (n > ancestor.number) this.headers.delete(n);
    this.current = { blockNumber: ancestor.number, blockHash: ancestor.hash };
    this.rollbacks++;
  }
  async promoteFinality(
    _chainId: typeof chainId,
    _consumer: string,
    _fenceToken: bigint,
    confirmed?: bigint,
    finalized?: bigint,
  ) {
    this.finalityPromotions.push({
      ...(confirmed === undefined ? {} : { confirmed }),
      ...(finalized === undefined ? {} : { finalized }),
    });
  }
}
function source(blockHashes: Map<bigint, `0x${string}`>, latest = 3n): IndexerSource {
  return {
    verifyChain: async (id) => {
      if (id !== chainId) throw new Error('wrong chain');
    },
    heads: async () => ({ latest, confirmed: latest - 1n, finalized: latest - 2n }),
    block: async (n) => ({
      number: n,
      hash: blockHashes.get(n)!,
      parentHash: n === 1n ? hash(0) : blockHashes.get(n - 1n)!,
      timestamp: n,
    }),
    logs: async (from) => [
      {
        transactionHash: hash(Number(from + 100n)),
        transactionIndex: 0,
        logIndex: 0,
        blockHash: blockHashes.get(from)!,
        blockNumber: from,
        address,
        topics: [hash(999)],
        data: '0x',
      },
    ],
  };
}
test('bounded ranges, finality and deterministic ordering', () => {
  assert.deepEqual(boundedRanges(10n, 15n, 2), [
    [10n, 11n],
    [12n, 13n],
    [14n, 15n],
  ]);
  assert.equal(finalityAt(1n, { latest: 3n, confirmed: 2n, finalized: 1n }), 'FINALIZED');
  const base = {
    chainId,
    transactionHash: hash(8),
    transactionIndex: 1,
    blockHash: hash(2),
    blockNumber: 2n,
    address,
    topics: [] as const,
    data: '0x' as const,
    finality: 'OBSERVED' as const,
  };
  const logs = [
    { ...base, logIndex: 2 },
    { ...base, transactionIndex: 0, logIndex: 1 },
  ];
  assert.equal(orderedLogs(logs)[0]!.logIndex, 1);
  assert.equal(logicalStateHash([], logs), logicalStateHash([], [...logs].reverse()));
});
test('replay source chain verification rejects a mismatched RPC', async () => {
  await assert.rejects(
    verifySourceChain(
      { ...source(new Map()), verifyChain: async () => Promise.reject(new Error('RPC_CHAIN_MISMATCH')) },
      chainId,
    ),
    /RPC_CHAIN_MISMATCH/,
  );
});
test('log range fallback splits only recognized provider range-limit errors', async () => {
  const rangeError = Object.assign(new Error('query returned too many results'), { code: -32005 });
  let requests = 0;
  const result = await fetchLogsByRange(1n, 4n, async (from, to) => {
    requests++;
    if (to - from > 0n) throw rangeError;
    return [from];
  });
  assert.deepEqual(result, [1n, 2n, 3n, 4n]);
  assert.equal(requests, 7);
  assert.equal(isBlockRangeLimitError(new Error('connection reset')), false);
  assert.equal(isBlockRangeLimitError(new Error('invalid block range syntax')), false);
  const invalidParams = Object.assign(new Error('Invalid parameters were provided'), {
    name: 'InvalidParamsRpcError',
    code: -32602,
  });
  let invalidParamRequests = 0;
  const splitResult = await fetchLogsByRange(1n, 4n, async (from, to) => {
    invalidParamRequests++;
    if (to > from) throw invalidParams;
    return [from];
  });
  assert.deepEqual(splitResult, [1n, 2n, 3n, 4n]);
  assert.equal(invalidParamRequests, 7);
  assert.equal(isBlockRangeLimitError(invalidParams), true);
  const restrictedRange = Object.assign(new Error('eth_getLogs requests accept up to a 10 block range'), {
    code: -32600,
  });
  assert.equal(isBlockRangeLimitError(restrictedRange), true);
  assert.equal(
    isBlockRangeLimitError(Object.assign(new Error('invalid request object'), { code: -32600 })),
    false,
  );
  let ordinaryRequests = 0;
  await assert.rejects(
    fetchLogsByRange(1n, 8n, async () => {
      ordinaryRequests++;
      throw new Error('connection reset');
    }),
    /connection reset/,
  );
  assert.equal(ordinaryRequests, 1);
  let invalidRangeRequests = 0;
  await assert.rejects(
    fetchLogsByRange(1n, 8n, async () => {
      invalidRangeRequests++;
      throw new Error('invalid block range syntax');
    }),
    /invalid block range syntax/,
  );
  assert.equal(invalidRangeRequests, 1);
  await assert.rejects(
    fetchLogsByRange(5n, 5n, async () => {
      throw invalidParams;
    }),
    /Invalid parameters/,
  );
});
test('indexer RPC diagnostics retain operation, bounded range and provider code without raw detail', () => {
  const cause = Object.assign(new Error('provider supplied private response'), {
    name: 'InvalidParamsRpcError',
    code: -32602,
  });
  const error = new IndexerRpcOperationError('getLogs', 100n, 199n, cause);
  assert.equal(error.operation, 'getLogs');
  assert.equal(error.fromBlock, 100n);
  assert.equal(error.toBlock, 199n);
  assert.equal(error.rpcCode, -32602);
  assert.equal(error.rpcCauseType, 'InvalidParamsRpcError');
  assert.equal(error.message.includes('private response'), false);
  assert.equal(error.cause, undefined);
});
test('bounded indexer source snapshot stays fixed while the provider head advances', async () => {
  let latest = 3n;
  const inner = source(
    new Map([
      [1n, hash(1)],
      [2n, hash(2)],
      [3n, hash(3)],
      [4n, hash(4)],
    ]),
    latest,
  );
  const dynamic: IndexerSource = {
    ...inner,
    heads: async () => ({ latest }),
  };
  const snapshot = await snapshotIndexerSource(dynamic);
  latest = 4n;
  assert.equal((await dynamic.heads()).latest, 4n);
  assert.equal((await snapshot.source.heads()).latest, 3n);
  assert.equal(snapshot.heads.latest, 3n);
});
test('ABI decoder decodes verified events and preserves unknown logs', () => {
  const decoder = new AbiEventDecoder(
    { PRICE_GUARD: address },
    { contracts: { PRICE_GUARD: { name: 'PriceGuard' } } },
  );
  const abi = [
    {
      type: 'event',
      name: 'OwnershipTransferred',
      inputs: [
        { indexed: true, name: 'previousOwner', type: 'address' },
        { indexed: true, name: 'newOwner', type: 'address' },
      ],
    },
  ] as const;
  const topics = encodeEventTopics({
    abi,
    eventName: 'OwnershipTransferred',
    args: { previousOwner: address, newOwner: `0x${'2'.repeat(40)}` },
  });
  assert.equal(
    decoder.decode(
      address,
      topics.filter((topic): topic is `0x${string}` => typeof topic === 'string'),
      '0x',
    ).eventName,
    'OwnershipTransferred',
  );
  assert.deepEqual(decoder.decode(address, [hash(999)], '0x'), {});
});
test('indexer commits cursor with events, resumes idempotently and rolls back shallow reorg', async () => {
  const hashes = new Map([
    [1n, hash(1)],
    [2n, hash(2)],
    [3n, hash(3)],
  ]);
  const store = new MemoryStore();
  const run = () =>
    new BlockchainIndexerService(chainId, 'test', 1n, 3, 3, [address], source(hashes), store, 1n).runOnce();
  assert.equal((await run()).logs, 1);
  assert.equal(store.current?.blockNumber, 3n);
  assert.equal(store.logs.size, 1);
  assert.equal((await run()).logs, 0);
  assert.deepEqual(store.finalityPromotions.at(-1), { confirmed: 2n, finalized: 1n });
  hashes.set(3n, hash(30));
  await run();
  assert.equal(store.rollbacks, 1);
  assert.equal(store.current?.blockHash, hash(30));
});
test('factory discovery fetches same-transaction logs for a newly created vault', async () => {
  const factory = address;
  const discovered = `0x${'2'.repeat(40)}` as const;
  const blockHashes = new Map([[1n, hash(1)]]);
  const store = new MemoryStore();
  const base = source(blockHashes, 1n);
  const synthetic: IndexerSource = {
    ...base,
    logs: async (_from, _to, addresses) => {
      if (addresses.includes(discovered))
        return [
          {
            transactionHash: hash(100),
            transactionIndex: 0,
            logIndex: 1,
            blockHash: hash(1),
            blockNumber: 1n,
            address: discovered,
            topics: [],
            data: '0x',
            eventName: 'Transfer',
            eventArgs: {
              from: `0x${'0'.repeat(40)}`,
              to: `0x${'3'.repeat(40)}`,
              value: '10',
            },
          },
        ];
      return [
        {
          transactionHash: hash(100),
          transactionIndex: 0,
          logIndex: 0,
          blockHash: hash(1),
          blockNumber: 1n,
          address: factory,
          topics: [],
          data: '0x',
          eventName: 'VaultCreated',
          eventArgs: { vault: discovered },
        },
      ];
    },
  };
  const result = await new BlockchainIndexerService(
    chainId,
    'test',
    1n,
    1,
    3,
    [factory],
    synthetic,
    store,
    1n,
  ).runOnce();
  assert.equal(result.logs, 2);
  assert.deepEqual(
    [...store.logs.values()].map((log) => log.eventName),
    ['VaultCreated', 'Transfer'],
  );
});
test('crash before commit does not advance cursor and deep reorg fails closed', async () => {
  const hashes = new Map([
    [1n, hash(1)],
    [2n, hash(2)],
    [3n, hash(3)],
  ]);
  const store = new MemoryStore();
  store.failCommit = true;
  await assert.rejects(() =>
    new BlockchainIndexerService(chainId, 'test', 1n, 3, 2, [address], source(hashes), store, 1n).runOnce(),
  );
  assert.equal(store.current, null);
  store.failCommit = false;
  await new BlockchainIndexerService(
    chainId,
    'test',
    1n,
    3,
    2,
    [address],
    source(hashes),
    store,
    1n,
  ).runOnce();
  hashes.set(1n, hash(10));
  hashes.set(2n, hash(20));
  hashes.set(3n, hash(30));
  await assert.rejects(
    () =>
      new BlockchainIndexerService(chainId, 'test', 1n, 3, 1, [address], source(hashes), store, 1n).runOnce(),
    /REORG_RECOVERY_LIMIT_EXCEEDED/,
  );
});
