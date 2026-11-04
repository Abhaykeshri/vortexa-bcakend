import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../dist/apps/api/src/config/env.js';
import {
  ViemIndexerSource,
  AbiEventDecoder,
} from '../dist/packages/adapters/src/indexer/viem-indexer-source.adapter.js';
import { PostgresIndexerStore } from '../dist/packages/adapters/src/postgres/postgres-indexer.repository.js';
import {
  connectRedis,
  RedisCoordinationAdapter,
} from '../dist/packages/adapters/src/redis-coordination.adapter.js';
import { chainScopedKey } from '../dist/packages/adapters/src/chain-registry.js';
import {
  BlockchainIndexerService,
  snapshotIndexerSource,
} from '../dist/packages/application/src/blockchain-indexer.service.js';

const config = loadConfig(undefined, undefined, 'indexer');
const consumer = 'm6-indexer';
const maxCatchupBlocks = 200n;
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 3,
  connectionTimeoutMillis: 10_000,
  application_name: 'vortexa-indexer-reorg-verifier',
});
const leaseKey = chainScopedKey(config.chainId, consumer);
const leaseOwner = RedisCoordinationAdapter.leaseOwner('staging-reorg-verifier');
let redis;
let coordination;
let leaseAcquired = false;
let store;
let fenceToken;
let canonicalIndexer;
let syntheticForkActive = false;
let terminalError;

function createIndexer(source, fence) {
  return new BlockchainIndexerService(
    config.chainId,
    consumer,
    BigInt(config.indexerStartBlock),
    config.indexerBatchSize,
    config.indexerMaxReorgDepth,
    Object.values(config.contracts),
    source,
    store,
    fence,
    config.indexerHeaderConcurrency,
  );
}

async function restoreCanonicalBranch() {
  if (!canonicalIndexer) return;
  await canonicalIndexer.runOnce();
  const cursor = await store.cursor(config.chainId, consumer);
  if (!cursor) throw new Error('Cursor missing during best-effort canonical recovery');
  const canonical = await store.canonicalHeader(config.chainId, cursor.blockNumber);
  if (!canonical || canonical.hash.toLowerCase() !== cursor.blockHash.toLowerCase())
    throw new Error('Best-effort canonical recovery did not restore cursor consistency');
}

try {
  const activity = await pool.query(
    `SELECT pg_backend_pid() AS pid,
            count(*) FILTER(WHERE application_name IN (
              'vortexa-indexer','vortexa-outbox','vortexa-indexer-reorg-verifier'
            )
              AND pid<>pg_backend_pid())::int AS active_workers
     FROM pg_stat_activity WHERE datname=current_database()`,
  );
  if (activity.rows[0]?.active_workers !== 0) throw new Error('Active worker prevents staging verification');

  store = new PostgresIndexerStore(pool);
  const source = new ViemIndexerSource(
    config.chainId,
    config.rpcUrls,
    new AbiEventDecoder(config.contracts, config.manifest),
    config.indexerConfirmations,
  );
  await source.verifyChain(config.chainId);
  const snapshot = await snapshotIndexerSource(source);
  const initialCursor = await store.cursor(config.chainId, consumer);
  if (!initialCursor) throw new Error('Staging indexer cursor is missing');
  const catchupGap = snapshot.heads.latest - initialCursor.blockNumber;
  if (catchupGap < 0n || catchupGap > maxCatchupBlocks)
    throw new Error('Staging catch-up exceeds the 200-block safety bound');
  const initialBlock = await source.block(initialCursor.blockNumber);
  if (initialBlock.hash.toLowerCase() !== initialCursor.blockHash.toLowerCase())
    throw new Error('Staging cursor is not canonical before verification');

  redis = await connectRedis(config.redisUrl);
  coordination = new RedisCoordinationAdapter(redis);
  if (!(await coordination.acquire(leaseKey, leaseOwner, 300_000)))
    throw new Error('Could not acquire exclusive indexer staging lease');
  leaseAcquired = true;
  fenceToken = await store.acquireFence(config.chainId, consumer);

  const boundedSource = snapshot.source;
  canonicalIndexer = createIndexer(boundedSource, fenceToken);
  let targetCursor = initialCursor;
  for (let batch = 0; targetCursor.blockNumber < snapshot.heads.latest; batch++) {
    if (batch >= 100 || snapshot.heads.latest - initialCursor.blockNumber > maxCatchupBlocks)
      throw new Error('Bounded catch-up exceeded its 200-block progress guard');
    const previousBlock = targetCursor.blockNumber;
    await canonicalIndexer.runOnce();
    targetCursor = await store.cursor(config.chainId, consumer);
    if (!targetCursor || targetCursor.blockNumber <= previousBlock)
      throw new Error('Bounded catch-up made no forward progress');
  }
  if (!targetCursor || targetCursor.blockNumber !== snapshot.heads.latest)
    throw new Error('Bounded catch-up did not reach the fixed RPC head snapshot');

  const targetHead = snapshot.heads.latest;
  const forkAncestor = targetHead - 2n;
  const finalizedBoundary = [snapshot.heads.confirmed, snapshot.heads.finalized]
    .filter((height) => height !== undefined)
    .reduce((latest, height) => (height > latest ? height : latest), 0n);
  if (forkAncestor < BigInt(config.indexerStartBlock) || forkAncestor < finalizedBoundary)
    throw new Error('Selected synthetic fork would touch confirmed/finalized history');

  const ancestorRpc = await source.block(forkAncestor);
  const ancestorStored = await store.canonicalHeader(config.chainId, forkAncestor);
  if (!ancestorStored || ancestorStored.hash.toLowerCase() !== ancestorRpc.hash.toLowerCase())
    throw new Error('Synthetic fork ancestor is not canonical');
  const branch = new Map();
  const nonce = randomUUID();
  for (let number = forkAncestor + 1n; number <= targetHead; number++) {
    const original = await source.block(number);
    const hash = `0x${createHash('sha256').update(`${nonce}:${number}`).digest('hex')}`;
    const parentHash = number === forkAncestor + 1n ? ancestorRpc.hash : branch.get(number - 1n).hash;
    branch.set(number, { ...original, hash, parentHash });
  }

  const journalBefore = await pool.query(
    `SELECT COALESCE(max(id),0)::text AS id FROM reorg_journal
     WHERE chain_id=$1 AND consumer=$2`,
    [config.chainId, consumer],
  );
  const forkSource = {
    verifyChain: (chainId) => boundedSource.verifyChain(chainId),
    heads: () => boundedSource.heads(),
    block: (number) => branch.get(number) ?? boundedSource.block(number),
    logs: async (fromBlock, toBlock, addresses) =>
      (await boundedSource.logs(fromBlock, toBlock, addresses)).map((log) => ({
        ...log,
        ...(branch.has(log.blockNumber) ? { blockHash: branch.get(log.blockNumber).hash } : {}),
      })),
  };
  syntheticForkActive = true;
  await createIndexer(forkSource, fenceToken).runOnce();
  const forkCursor = await store.cursor(config.chainId, consumer);
  if (
    !forkCursor ||
    forkCursor.blockNumber !== targetHead ||
    forkCursor.blockHash !== branch.get(targetHead).hash
  )
    throw new Error('Synthetic fork did not commit at the fixed head snapshot');
  const forkJournal = await pool.query(
    `SELECT depth,ancestor_block::text AS ancestor_block FROM reorg_journal
     WHERE chain_id=$1 AND consumer=$2 AND id>$3::bigint ORDER BY id DESC LIMIT 1`,
    [config.chainId, consumer, journalBefore.rows[0].id],
  );
  if (forkJournal.rows[0]?.depth !== 2 || forkJournal.rows[0]?.ancestor_block !== forkAncestor.toString())
    throw new Error('Synthetic fork journal does not match the fixed depth-2 test');

  await canonicalIndexer.runOnce();
  const restoredCursor = await store.cursor(config.chainId, consumer);
  const canonicalTarget = await source.block(targetHead);
  if (
    !restoredCursor ||
    restoredCursor.blockNumber !== targetHead ||
    restoredCursor.blockHash.toLowerCase() !== canonicalTarget.hash.toLowerCase()
  )
    throw new Error('Canonical recovery did not restore the cursor at the fixed head snapshot');
  syntheticForkActive = false;
  const journalAfter = await pool.query(
    `SELECT count(*)::int AS count FROM reorg_journal
     WHERE chain_id=$1 AND consumer=$2 AND id>$3::bigint`,
    [config.chainId, consumer, journalBefore.rows[0].id],
  );
  if (journalAfter.rows[0]?.count !== 2)
    throw new Error('Expected exactly fork and canonical recovery journal entries');
  const reconciliation = await store.reconcile(config.chainId, consumer);
  if (!reconciliation.ok) throw new Error('Post-reorg reconciliation failed');

  console.log(
    JSON.stringify({
      result: 'PASS',
      chainId: config.chainId,
      snapshotHead: targetHead.toString(),
      caughtUpFrom: initialCursor.blockNumber.toString(),
      forkDepth: forkJournal.rows[0].depth,
      ancestor: forkAncestor.toString(),
      restoredCursor: restoredCursor.blockNumber.toString(),
      journalEntries: journalAfter.rows[0].count,
      reconciliation: {
        gaps: reconciliation.gaps,
        duplicates: reconciliation.duplicates,
        cursorMatchesHead: reconciliation.cursorMatchesHead,
      },
    }),
  );
} catch (error) {
  terminalError = error;
  throw error;
} finally {
  if (syntheticForkActive && canonicalIndexer) {
    try {
      await restoreCanonicalBranch();
    } catch (error) {
      terminalError ??= error;
    }
  }
  if (store && fenceToken !== undefined) {
    try {
      await store.finishWorker(
        config.chainId,
        consumer,
        fenceToken,
        terminalError ? 'DEGRADED' : 'STOPPED',
        terminalError instanceof Error ? terminalError.name : terminalError ? 'unknown' : null,
      );
    } catch (error) {
      terminalError ??= error;
    }
  }
  if (leaseAcquired && coordination) {
    try {
      if (!(await coordination.release(leaseKey, leaseOwner)))
        terminalError ??= new Error('Staging verifier lease release was not confirmed');
    } catch (error) {
      terminalError ??= error;
    }
  }
  if (redis) {
    try {
      await redis.quit();
    } catch (error) {
      terminalError ??= error;
    }
  }
  try {
    await pool.end();
  } catch (error) {
    terminalError ??= error;
  }
  if (terminalError && !process.exitCode) process.exitCode = 1;
}
