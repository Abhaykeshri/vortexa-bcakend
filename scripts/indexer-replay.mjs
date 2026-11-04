import pg from 'pg';
import { loadConfig } from '../dist/apps/api/src/config/env.js';
import {
  AbiEventDecoder,
  ViemIndexerSource,
} from '../dist/packages/adapters/src/indexer/viem-indexer-source.adapter.js';
import { PostgresIndexerStore } from '../dist/packages/adapters/src/postgres/postgres-indexer.repository.js';
import {
  boundedRanges,
  finalityAt,
  logicalStateHash,
  orderedLogs,
  verifySourceChain,
} from '../dist/packages/application/src/blockchain-indexer.service.js';
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []),
);
const config = loadConfig(undefined, undefined, 'tool');
if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
const chainId = Number(args['chain-id'] ?? config.chainId);
if (chainId !== config.chainId) throw new Error('Unsupported chain');
const from = BigInt(args['from-block']);
const to = BigInt(args['to-block']);
const source = new ViemIndexerSource(
  chainId,
  config.rpcUrls,
  new AbiEventDecoder(config.contracts, config.manifest),
);
await verifySourceChain(source, chainId);
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 1,
  application_name: 'vortexa-replay',
});
const store = new PostgresIndexerStore(pool);
const fenceToken = await store.acquireFence(chainId, 'indexer-replay');
const allHeaders = [];
const allLogs = [];
const heads = await source.heads();
try {
  for (const [start, end] of boundedRanges(from, to, 500)) {
    const headers = [];
    for (const [chunkStart, chunkEnd] of boundedRanges(start, end, config.indexerHeaderConcurrency ?? 10)) {
      const blocks = await Promise.all(
        Array.from({ length: Number(chunkEnd - chunkStart + 1n) }, (_, offset) =>
          source.block(chunkStart + BigInt(offset)),
        ),
      );
      for (const block of blocks)
        headers.push({ ...block, chainId, finality: finalityAt(block.number, heads) });
    }
    const logs = orderedLogs(await source.logs(start, end, Object.values(config.contracts))).map((l) => ({
      ...l,
      chainId,
      finality: finalityAt(l.blockNumber, heads),
    }));
    await store.commitBatch('indexer-replay', fenceToken, headers, logs);
    allHeaders.push(...headers);
    allLogs.push(...logs);
  }
  console.log(
    JSON.stringify({
      chainId,
      from: from.toString(),
      to: to.toString(),
      logs: allLogs.length,
      logicalStateHash: logicalStateHash(allHeaders, allLogs),
    }),
  );
} finally {
  await pool.end();
}
