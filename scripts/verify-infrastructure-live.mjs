import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createClient } from 'redis';
import { loadConfig } from '../dist/apps/api/src/config/env.js';
import { PostgresIndexerStore } from '../dist/packages/adapters/src/postgres/postgres-indexer.repository.js';
import { DrizzleVaultProjectionRepository } from '../dist/packages/adapters/src/postgres/vault-projection.repository.js';
import { DurableWorkRepository } from '../dist/packages/adapters/src/postgres/repositories.js';
import { RedisCoordinationAdapter } from '../dist/packages/adapters/src/redis-coordination.adapter.js';
import { BlockchainIndexerService } from '../dist/packages/application/src/blockchain-indexer.service.js';
import { NotificationOutboxWorker } from '../dist/packages/application/src/notification-outbox.worker.js';

const config = loadConfig(undefined, undefined, 'tool');
if (!config.databaseUrl || !config.redisUrl) throw new Error('DATABASE_URL and REDIS_URL are required');
const suffix = randomUUID().replaceAll('-', '');
const schema = `vortexa_verify_${suffix}`;
if (!/^vortexa_verify_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe verification schema');
const migrations = await Promise.all(
  ['0001_m0_m5_foundation', '0002_m6_indexer', '0003_m5_outbox_m6_fencing', '0004_m7_vault_catalog'].map(
    async (version) => {
      const sql = await readFile(`packages/adapters/migrations/${version}.sql`, 'utf8');
      return { version, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    },
  ),
);
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 3,
  connectionTimeoutMillis: 10000,
  options: `-c search_path=${schema}`,
  application_name: 'vortexa-live-verifier',
});
try {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(
      'CREATE TABLE vortexa_schema_migrations(version text PRIMARY KEY, checksum text NOT NULL)',
    );
    const applyMigrations = async () => {
      let changed = false;
      for (const migration of migrations) {
        const applied = await client.query(
          'SELECT checksum FROM vortexa_schema_migrations WHERE version=$1',
          [migration.version],
        );
        if (applied.rows[0]) {
          if (applied.rows[0].checksum !== migration.checksum) throw new Error('Migration checksum mismatch');
          continue;
        }
        await client.query('BEGIN');
        try {
          await client.query(migration.sql);
          await client.query('INSERT INTO vortexa_schema_migrations(version,checksum) VALUES($1,$2)', [
            migration.version,
            migration.checksum,
          ]);
          await client.query('COMMIT');
          changed = true;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
      return changed;
    };
    if (!(await applyMigrations()) || (await applyMigrations()))
      throw new Error('Migration repeat was not a no-op');
    const address = config.contracts.VAULT.toLowerCase();
    await client.query(
      'INSERT INTO vaults(chain_id,address,strategy,shape_id,owner_role,as_of_block) VALUES($1,$2,$3,$4,$5,$6)',
      [config.chainId, address, 'NormalLP', 3, 'GOVERNANCE_ONLY', '123456789012345678901'],
    );
    const read = await client.query('SELECT as_of_block FROM vaults WHERE chain_id=$1 AND address=$2', [
      config.chainId,
      address,
    ]);
    if (read.rows[0]?.as_of_block !== '123456789012345678901')
      throw new Error('PostgreSQL bigint CRUD mismatch');
    await client.query('UPDATE vaults SET shape_id=$1 WHERE chain_id=$2 AND address=$3', [
      4,
      config.chainId,
      address,
    ]);
    await client.query('BEGIN');
    await client.query('DELETE FROM vaults WHERE chain_id=$1', [config.chainId]);
    await client.query('ROLLBACK');
    if ((await client.query('SELECT count(*)::int AS count FROM vaults')).rows[0]?.count !== 1)
      throw new Error('PostgreSQL rollback failed');
    let duplicateRejected = false;
    try {
      await client.query(
        'INSERT INTO vaults(chain_id,address,strategy,shape_id,owner_role,as_of_block) VALUES($1,$2,$3,$4,$5,$6)',
        [config.chainId, address, 'NormalLP', 3, 'GOVERNANCE_ONLY', '1'],
      );
    } catch (error) {
      duplicateRejected = error?.code === '23505';
    }
    if (!duplicateRejected) throw new Error('PostgreSQL duplicate constraint failed');
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO headers(chain_id,block_number,block_hash,parent_hash,block_timestamp,finality) VALUES($1,1,$2,$3,now(),'OBSERVED')`,
      [config.chainId, `0x${'1'.repeat(64)}`, `0x${'0'.repeat(64)}`],
    );
    await client.query(
      `INSERT INTO raw_logs(chain_id,transaction_hash,transaction_index,log_index,block_hash,block_number,address,topics,data,finality) VALUES($1,$2,0,0,$3,1,$4,'[]','0x','OBSERVED')`,
      [config.chainId, `0x${'2'.repeat(64)}`, `0x${'1'.repeat(64)}`, address],
    );
    await client.query(
      `INSERT INTO cursors(chain_id,consumer,block_number,block_hash) VALUES($1,'indexer-verify',1,$2)`,
      [config.chainId, `0x${'1'.repeat(64)}`],
    );
    await client.query('ROLLBACK');
    if (
      (await client.query(`SELECT count(*)::int count FROM cursors WHERE consumer='indexer-verify'`)).rows[0]
        ?.count !== 0
    )
      throw new Error('Atomic indexer rollback failed');
    const work = new DurableWorkRepository(pool);
    const idempotencyKey = `verify-${suffix}`;
    if (!(await work.enqueue('verify', idempotencyKey, {}))) throw new Error('Outbox enqueue failed');
    const [claimedA, claimedB] = await Promise.all([
      work.claimOutbox('verify-worker-a', 1),
      work.claimOutbox('verify-worker-b', 1),
    ]);
    if (claimedA.length + claimedB.length !== 1) throw new Error('Concurrent outbox claim was not exclusive');
    const originalOwner = claimedA.length ? 'verify-worker-a' : 'verify-worker-b';
    const outboxId = claimedA[0]?.id ?? claimedB[0]?.id;
    if (!outboxId) throw new Error('Claimed outbox row missing');
    await pool.query("UPDATE outbox SET claim_until=now()-interval '1 second' WHERE id=$1", [outboxId]);
    const [recovered] = await work.claimOutbox('verify-worker-recovery', 1);
    if (!recovered || recovered.id !== outboxId) throw new Error('Expired outbox claim was not recovered');
    let staleCompletionRejected = false;
    try {
      await work.completeOutbox(outboxId, originalOwner);
    } catch (error) {
      staleCompletionRejected = error instanceof Error && error.message.includes('claim lost');
    }
    if (!staleCompletionRejected) throw new Error('Stale outbox owner completed a recovered claim');
    await work.completeOutbox(outboxId, 'verify-worker-recovery');

    const retryKey = `verify-retry-${suffix}`;
    if (!(await work.enqueue('verify-retry', retryKey, {}))) throw new Error('Retry outbox enqueue failed');
    const retryOwner = 'verify-retry-worker-a';
    const [firstAttempt] = await work.claimOutbox(retryOwner, 1);
    if (!firstAttempt) throw new Error('Initial retry claim missing');
    await work.failOutbox(firstAttempt.id, retryOwner, 'simulated transient failure', 2, 1);
    const delayedRetry = await pool.query(
      'SELECT attempts,available_at>now() AS delayed,dead_lettered_at FROM outbox WHERE id=$1',
      [firstAttempt.id],
    );
    if (
      delayedRetry.rows[0]?.attempts !== 1 ||
      delayedRetry.rows[0]?.delayed !== true ||
      delayedRetry.rows[0]?.dead_lettered_at !== null
    )
      throw new Error('Outbox retry was not scheduled');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const retryOwnerB = 'verify-retry-worker-b';
    const [secondAttempt] = await work.claimOutbox(retryOwnerB, 1);
    if (!secondAttempt || secondAttempt.id !== firstAttempt.id || secondAttempt.attempts !== 1)
      throw new Error('Outbox retry was not reclaimed');
    await work.failOutbox(secondAttempt.id, retryOwnerB, 'simulated terminal failure', 2, 1);
    const deadLetter = await pool.query(
      'SELECT dead_lettered_at IS NOT NULL AS dead_lettered FROM outbox WHERE id=$1',
      [secondAttempt.id],
    );
    if (deadLetter.rows[0]?.dead_lettered !== true) throw new Error('Outbox retry was not dead-lettered');

    const workerKey = `verify-worker-retry-${suffix}`;
    if (!(await work.enqueue('verify-worker-retry', workerKey, {})))
      throw new Error('Outbox worker test enqueue failed');
    let publishAttempts = 0;
    const worker = new NotificationOutboxWorker(work, {
      async publish() {
        publishAttempts++;
        if (publishAttempts === 1) throw new Error('simulated notification publish failure');
      },
    });
    const firstRun = await worker.runOnce('verify-outbox-worker', 1);
    if (firstRun.processed !== 0 || firstRun.failed !== 1)
      throw new Error('Outbox worker did not record the simulated publish failure');
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const secondRun = await worker.runOnce('verify-outbox-worker', 1);
    if (secondRun.processed !== 1 || secondRun.failed !== 0 || publishAttempts !== 2)
      throw new Error('Outbox worker did not publish the retried notification');
    const workerRecovery = await pool.query(
      'SELECT processed_at IS NOT NULL AS processed,attempts FROM outbox WHERE idempotency_key=$1',
      [workerKey],
    );
    if (workerRecovery.rows[0]?.processed !== true || workerRecovery.rows[0]?.attempts !== 2)
      throw new Error('Outbox worker retry did not complete durably');

    const indexerStore = new PostgresIndexerStore(pool);
    const fenceA = await indexerStore.acquireFence(config.chainId, 'indexer-fence-verify');
    const fenceB = await indexerStore.acquireFence(config.chainId, 'indexer-fence-verify');
    const testHeader = {
      chainId: config.chainId,
      number: 1n,
      hash: `0x${'3'.repeat(64)}`,
      parentHash: `0x${'0'.repeat(64)}`,
      timestamp: 1n,
      finality: 'OBSERVED',
    };
    let staleFenceRejected = false;
    try {
      await indexerStore.commitBatch('indexer-fence-verify', fenceA, [testHeader], []);
    } catch (error) {
      staleFenceRejected = error instanceof Error && error.message === 'INDEXER_FENCE_LOST';
    }
    if (!staleFenceRejected) throw new Error('Stale indexer fence committed a batch');
    await indexerStore.commitBatch('indexer-fence-verify', fenceB, [testHeader], []);

    const projectionConsumer = 'projection-verify';
    const projectionFence = await indexerStore.acquireFence(config.chainId, projectionConsumer);
    const projectedVault = `0x${'7'.repeat(40)}`;
    const projectedVaultCreator = `0x${'8'.repeat(40)}`;
    const projectionHeader100 = {
      chainId: config.chainId,
      number: 100n,
      hash: `0x${'a'.repeat(64)}`,
      parentHash: `0x${'9'.repeat(64)}`,
      timestamp: 1700000100n,
      finality: 'FINALIZED',
    };
    const vaultCreatedEvent = {
      chainId: config.chainId,
      transactionHash: `0x${'b'.repeat(64)}`,
      transactionIndex: 0,
      logIndex: 0,
      blockHash: projectionHeader100.hash,
      blockNumber: 100n,
      address: config.contracts.VAULT_FACTORY,
      topics: [],
      data: '0x',
      eventName: 'VaultCreated',
      eventArgs: {
        vault: projectedVault,
        creator: projectedVaultCreator,
        poolId: `0x${'c'.repeat(64)}`,
        strategy: 0,
        strategyContract: config.contracts.NORMAL_LP_STRATEGY,
      },
      finality: 'FINALIZED',
    };
    await indexerStore.commitBatch(
      projectionConsumer,
      projectionFence,
      [projectionHeader100],
      [vaultCreatedEvent],
    );
    const projectionHeader101 = {
      chainId: config.chainId,
      number: 101n,
      hash: `0x${'d'.repeat(64)}`,
      parentHash: projectionHeader100.hash,
      timestamp: 1700000101n,
      finality: 'CONFIRMED',
    };
    const shareTransferEvent = {
      chainId: config.chainId,
      transactionHash: `0x${'e'.repeat(64)}`,
      transactionIndex: 0,
      logIndex: 1,
      blockHash: projectionHeader101.hash,
      blockNumber: 101n,
      address: projectedVault,
      topics: [],
      data: '0x',
      eventName: 'Transfer',
      eventArgs: {
        from: '0x0000000000000000000000000000000000000000',
        to: projectedVaultCreator,
        value: '10',
      },
      finality: 'CONFIRMED',
    };
    await indexerStore.commitBatch(
      projectionConsumer,
      projectionFence,
      [projectionHeader101],
      [shareTransferEvent],
    );
    await indexerStore.commitBatch(
      projectionConsumer,
      projectionFence,
      [projectionHeader101],
      [shareTransferEvent],
    );
    const projectedShares = await pool.query(
      'SELECT total_shares FROM vaults WHERE chain_id=$1 AND address=$2',
      [config.chainId, projectedVault],
    );
    if (projectedShares.rows[0]?.total_shares !== '10')
      throw new Error('Duplicate vault projection was not idempotent');
    const projectionRepository = new DrizzleVaultProjectionRepository(pool);
    const projected = await projectionRepository.findVault(config.chainId, projectedVault);
    const holders = await projectionRepository.listVaultHolders(config.chainId, projectedVault);
    if (!projected || projected.totalShares !== 10n || holders[0]?.shares !== 10n)
      throw new Error('Drizzle vault projection read mismatch');
    await projectionRepository.savePinnedSnapshot({
      chainId: config.chainId,
      blockNumber: 101n,
      blockHash: projectionHeader101.hash,
      finality: 'CONFIRMED',
      vaults: [
        {
          vaultAddress: projectedVault,
          blockNumber: 101n,
          blockHash: projectionHeader101.hash,
          strategyContract: config.contracts.NORMAL_LP_STRATEGY,
          config: { shapeId: '3', accountingSource: 'vaultLens' },
          totalShares: 10n,
          totalAssets: 25n,
          totalAssets0: 11n,
          totalAssets1: 14n,
          accountingAvailable: true,
        },
      ],
      positions: [
        {
          vaultAddress: projectedVault,
          walletAddress: projectedVaultCreator,
          blockNumber: 101n,
          shares: 10n,
          amount0: 4n,
          amount1: 6n,
          accountingAvailable: true,
        },
      ],
    });
    const refreshedVault = await projectionRepository.findVault(config.chainId, projectedVault);
    const refreshedHolders = await projectionRepository.listVaultHolders(config.chainId, projectedVault);
    if (
      !refreshedVault ||
      refreshedVault.shapeId !== 3 ||
      refreshedVault.totalAssets !== 25n ||
      refreshedHolders[0]?.amount0 !== 4n ||
      refreshedHolders[0]?.amount1 !== 6n
    )
      throw new Error('Atomic pinned snapshot write/read mismatch');
    await indexerStore.rollbackTo(
      config.chainId,
      projectionConsumer,
      projectionFence,
      projectionHeader100,
      1,
    );
    const rolledBack = await pool.query('SELECT total_shares FROM vaults WHERE chain_id=$1 AND address=$2', [
      config.chainId,
      projectedVault,
    ]);
    if (rolledBack.rows[0]?.total_shares !== '0')
      throw new Error('Projection rollback did not invert supply');
    await indexerStore.commitBatch(
      projectionConsumer,
      projectionFence,
      [projectionHeader101],
      [shareTransferEvent],
    );
    const replayed = await pool.query('SELECT total_shares FROM vaults WHERE chain_id=$1 AND address=$2', [
      config.chainId,
      projectedVault,
    ]);
    if (replayed.rows[0]?.total_shares !== '10')
      throw new Error('Projection replay did not restore projection');

    const reorgConsumer = 'indexer-reorg-verify';
    const reorgFence = await indexerStore.acquireFence(config.chainId, reorgConsumer);
    const hash = (value) => `0x${value.toString(16).padStart(64, '0')}`;
    const blocks = new Map([
      [10n, { number: 10n, hash: hash(10), parentHash: hash(9), timestamp: 1700000010n }],
      [11n, { number: 11n, hash: hash(11), parentHash: hash(10), timestamp: 1700000011n }],
      [12n, { number: 12n, hash: hash(12), parentHash: hash(11), timestamp: 1700000012n }],
      [13n, { number: 13n, hash: hash(13), parentHash: hash(12), timestamp: 1700000013n }],
    ]);
    let forked = false;
    const reorgAddress = config.contracts.VAULT;
    const reorgSource = {
      verifyChain: async () => {},
      heads: async () => ({ latest: 13n, confirmed: 12n, finalized: 10n }),
      block: async (number) => {
        const block = blocks.get(number);
        if (!block) throw new Error(`Unexpected verification block: ${number}`);
        return block;
      },
      logs: async () => [
        {
          transactionHash: forked ? hash(44) : hash(4),
          transactionIndex: 0,
          logIndex: 0,
          blockHash: blocks.get(12n).hash,
          blockNumber: 12n,
          address: reorgAddress,
          topics: [],
          data: '0x',
        },
        {
          transactionHash: forked ? hash(55) : hash(5),
          transactionIndex: 0,
          logIndex: 0,
          blockHash: blocks.get(13n).hash,
          blockNumber: 13n,
          address: reorgAddress,
          topics: [],
          data: '0x',
        },
      ],
    };
    const reorgIndexer = new BlockchainIndexerService(
      config.chainId,
      reorgConsumer,
      10n,
      4,
      3,
      [reorgAddress],
      reorgSource,
      indexerStore,
      reorgFence,
      2,
    );
    await reorgIndexer.runOnce();
    blocks.set(11n, {
      number: 11n,
      hash: hash(111),
      parentHash: hash(10),
      timestamp: 1700000011n,
    });
    blocks.set(12n, {
      number: 12n,
      hash: hash(112),
      parentHash: hash(111),
      timestamp: 1700000012n,
    });
    blocks.set(13n, {
      number: 13n,
      hash: hash(113),
      parentHash: hash(112),
      timestamp: 1700000013n,
    });
    forked = true;
    await reorgIndexer.runOnce();
    const recoveredCursor = await indexerStore.cursor(config.chainId, reorgConsumer);
    if (recoveredCursor?.blockNumber !== 13n || recoveredCursor.blockHash !== hash(113))
      throw new Error('Reorg recovery did not advance to the replacement branch');
    const reorgRecord = await client.query(
      'SELECT depth,orphaned_hashes FROM reorg_journal WHERE chain_id=$1 AND consumer=$2 ORDER BY id DESC LIMIT 1',
      [config.chainId, reorgConsumer],
    );
    if (
      reorgRecord.rows[0]?.depth !== 3 ||
      ![hash(11), hash(12), hash(13)].every((orphan) => reorgRecord.rows[0]?.orphaned_hashes.includes(orphan))
    )
      throw new Error('Reorg journal did not record the orphaned branch');
    const reorgHeaders = await client.query(
      'SELECT block_hash,canonical FROM headers WHERE chain_id=$1 AND block_hash=ANY($2::text[])',
      [config.chainId, [hash(11), hash(12), hash(13), hash(111), hash(112), hash(113)]],
    );
    if (
      ![hash(11), hash(12), hash(13)].every(
        (orphan) => reorgHeaders.rows.find((row) => row.block_hash === orphan)?.canonical === false,
      ) ||
      ![hash(111), hash(112), hash(113)].every(
        (replacement) => reorgHeaders.rows.find((row) => row.block_hash === replacement)?.canonical === true,
      )
    )
      throw new Error('Reorg recovery canonical header state mismatch');
    const reorgLogs = await client.query(
      'SELECT transaction_hash,canonical FROM raw_logs WHERE chain_id=$1 AND transaction_hash=ANY($2::text[])',
      [config.chainId, [hash(4), hash(5), hash(44), hash(55)]],
    );
    if (
      ![hash(4), hash(5)].every(
        (orphan) => reorgLogs.rows.find((row) => row.transaction_hash === orphan)?.canonical === false,
      ) ||
      ![hash(44), hash(55)].every(
        (replacement) =>
          reorgLogs.rows.find((row) => row.transaction_hash === replacement)?.canonical === true,
      )
    )
      throw new Error('Reorg recovery canonical log state mismatch');
    await client.query('DELETE FROM vaults WHERE chain_id=$1 AND address=$2', [config.chainId, address]);
    console.log('PostgreSQL migrations/Drizzle/projections/duplicate/reorg/replay/outbox/fencing: PASS');
  } finally {
    client.release();
  }
} finally {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await pool.end();
}

const redis = createClient({
  url: config.redisUrl,
  socket: { connectTimeout: 10000, reconnectStrategy: false },
});
redis.on('error', () => {});
const prefix = `vortexa:verify:${suffix}`;
const keys = [`${prefix}:value`, `${prefix}:lease`, `${prefix}:rate`];
const coordination = new RedisCoordinationAdapter(redis);
const indexerLeaseKey = `verify_${suffix}_chain_${config.chainId}_indexer`;
const indexerOwnerA = RedisCoordinationAdapter.leaseOwner('verify-indexer-a');
const indexerOwnerB = RedisCoordinationAdapter.leaseOwner('verify-indexer-b');
try {
  await redis.connect();
  await redis.set(keys[0], JSON.stringify({ ok: true }), { EX: 30 });
  if (!(await redis.get(keys[0])) || (await redis.ttl(keys[0])) <= 0)
    throw new Error('Redis value/TTL failed');
  const responseCache = new RedisCoordinationAdapter(redis, `vortexa_verify_${suffix}`);
  const responseKey = 'vaults.chain_11155111.filters_none.scope_public:v1.g1:start:25';
  await responseCache.set(responseKey, { ok: true }, 1);
  if (!(await responseCache.get(responseKey))) throw new Error('Response cache write/read failed');
  await new Promise((resolve) => setTimeout(resolve, 1100));
  if ((await responseCache.get(responseKey)) !== null) throw new Error('Response cache TTL did not expire');
  if ((await redis.set(keys[1], 'worker-a', { NX: true, PX: 5000 })) !== 'OK')
    throw new Error('Redis lease failed');
  if ((await redis.set(keys[1], 'worker-b', { NX: true, PX: 5000 })) !== null)
    throw new Error('Redis duplicate lease allowed');
  await redis.incr(keys[2]);
  await redis.expire(keys[2], 30);
  await redis.del(keys[1]);
  if ((await redis.set(keys[1], 'worker-a', { NX: true, PX: 250 })) !== 'OK')
    throw new Error('Redis expiry lease setup failed');
  await new Promise((resolve) => setTimeout(resolve, 350));
  if ((await redis.set(keys[1], 'worker-b', { NX: true, PX: 5000 })) !== 'OK')
    throw new Error('Redis expired lease takeover failed');
  if (!(await coordination.acquire(indexerLeaseKey, indexerOwnerA, 5000)))
    throw new Error('Indexer lease acquisition failed');
  if (await coordination.acquire(indexerLeaseKey, indexerOwnerB, 5000))
    throw new Error('Indexer lease admitted a competing owner');
  if (await coordination.renew(indexerLeaseKey, indexerOwnerB, 5000))
    throw new Error('Indexer lease accepted a stale owner renewal');
  if (!(await coordination.release(indexerLeaseKey, indexerOwnerA)))
    throw new Error('Indexer lease setup release failed');
  if (!(await coordination.acquire(indexerLeaseKey, indexerOwnerA, 250)))
    throw new Error('Indexer expiry lease setup failed');
  await new Promise((resolve) => setTimeout(resolve, 350));
  if (!(await coordination.acquire(indexerLeaseKey, indexerOwnerB, 5000)))
    throw new Error('Indexer lease expiry takeover failed');
  if (await coordination.release(indexerLeaseKey, indexerOwnerA))
    throw new Error('Indexer lease accepted a stale owner release');
  if (!(await coordination.renew(indexerLeaseKey, indexerOwnerB, 5000)))
    throw new Error('Indexer lease renewal failed');
  if (!(await coordination.release(indexerLeaseKey, indexerOwnerB)))
    throw new Error('Indexer lease release failed');
  await redis.close();
  await redis.connect();
  if ((await redis.ping()) !== 'PONG') throw new Error('Redis reconnect failed');
  console.log('Redis value/TTL/indexer lease fencing/response-cache expiry/reconnect: PASS');
} finally {
  if (redis.isOpen) {
    await coordination.release(indexerLeaseKey, indexerOwnerA);
    await coordination.release(indexerLeaseKey, indexerOwnerB);
    await redis.del(keys).catch(() => {});
    await redis.close();
  }
}
