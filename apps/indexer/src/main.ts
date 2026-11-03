import pg from 'pg';
import { loadConfig } from '../../api/src/config/env.js';
import { ChainIndexer, delayOrAbort, indexerRetryDelay } from '../../../packages/application/src/indexer.js';
import {
  AbiEventDecoder,
  IndexerRpcOperationError,
  ViemIndexerSource,
} from '../../../packages/adapters/src/indexer/viem-source.js';
import { PostgresIndexerStore } from '../../../packages/adapters/src/postgres/indexer-store.js';
import { connectRedis, RedisCoordinationAdapter } from '../../../packages/adapters/src/redis-coordination.js';
import { chainScopedKey } from '../../../packages/adapters/src/chain-registry.js';
import { DrizzleM7VaultRepository } from '../../../packages/adapters/src/postgres/m7-repository.js';
import { ViemPinnedVaultStateReader } from '../../../packages/adapters/src/m7-pinned-reader.js';
import { M7ProjectionRefresher } from '../../../packages/application/src/m7-projection-refresher.js';

async function start() {
  const config = loadConfig();
  if (
    !config.indexerEnabled ||
    !config.indexerChainId ||
    config.indexerStartBlock === undefined ||
    !config.indexerBatchSize ||
    !config.indexerHeaderConcurrency ||
    !config.indexerPollIntervalMs ||
    !config.indexerMaxReorgDepth ||
    !config.indexerWorkerId ||
    !config.databaseUrl ||
    !config.redisUrl
  )
    throw new Error('Indexer is disabled or incompletely configured');
  const pollIntervalMs = config.indexerPollIntervalMs;
  const workerId = config.indexerWorkerId;
  const leaseOwner = RedisCoordinationAdapter.leaseOwner(workerId);
  const log = (level: string, event: string, detail: Record<string, unknown> = {}) =>
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        event,
        chainId: config.indexerChainId,
        ...detail,
      }),
    );
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 4,
    application_name: 'vortexa-indexer',
  });
  const leaseKey = chainScopedKey(config.indexerChainId, 'm6_indexer');
  const leaseTtl = Math.max(pollIntervalMs * 3, 15000);
  let stopping = false;
  const stopController = new AbortController();
  const stop = () => {
    stopping = true;
    stopController.abort();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let redis: Awaited<ReturnType<typeof connectRedis>> | undefined;
  let coordination: RedisCoordinationAdapter | undefined;
  let store: PostgresIndexerStore | undefined;
  let fenceToken: bigint | undefined;
  let terminalError: unknown;
  let leaseAcquired = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    redis = await connectRedis(config.redisUrl);
    coordination = new RedisCoordinationAdapter(redis);
    leaseAcquired = await coordination.acquire(leaseKey, leaseOwner, leaseTtl);
    if (!leaseAcquired) throw new Error('Indexer lease unavailable');
    const source = new ViemIndexerSource(
      config.indexerChainId,
      config.rpcUrls,
      new AbiEventDecoder(config.contracts, config.manifest),
      config.indexerConfirmations,
    );
    store = new PostgresIndexerStore(pool);
    const m7Repository = new DrizzleM7VaultRepository(pool);
    const m7Refresher = new M7ProjectionRefresher(
      config.indexerChainId,
      m7Repository,
      new ViemPinnedVaultStateReader(config.rpcUrls, config.indexerChainId, config.contracts.VAULT_LENS),
      m7Repository,
    );
    fenceToken = await store.acquireFence(config.indexerChainId, 'm6-indexer');
    const indexer = new ChainIndexer(
      config.indexerChainId,
      'm6-indexer',
      config.indexerStartBlock,
      config.indexerBatchSize,
      config.indexerMaxReorgDepth,
      Object.values(config.contracts),
      source,
      store,
      fenceToken,
      config.indexerHeaderConcurrency,
    );
    let leaseHealthy = true;
    let leaseValidUntil = Date.now() + leaseTtl;
    let heartbeatRunning = false;
    heartbeat = setInterval(
      () => {
        if (heartbeatRunning || !coordination) return;
        heartbeatRunning = true;
        void coordination
          .renew(leaseKey, leaseOwner, leaseTtl)
          .then((renewed) => {
            if (renewed) leaseValidUntil = Date.now() + leaseTtl;
            else if (Date.now() >= leaseValidUntil - Math.floor(leaseTtl / 3)) leaseHealthy = false;
          })
          .catch(() => {
            if (Date.now() >= leaseValidUntil - Math.floor(leaseTtl / 3)) leaseHealthy = false;
          })
          .finally(() => {
            heartbeatRunning = false;
          });
      },
      Math.max(Math.floor(leaseTtl / 3), 1000),
    );
    let failures = 0;
    let projectionRefreshPending = true;
    while (!stopping) {
      if (!leaseHealthy) throw new Error('Indexer lease heartbeat failed');
      if (!(await coordination.renew(leaseKey, leaseOwner, leaseTtl))) throw new Error('Indexer lease lost');
      leaseValidUntil = Date.now() + leaseTtl;
      try {
        const result = await indexer.runOnce();
        if (result.to !== undefined) projectionRefreshPending = true;
        let projection = { vaults: 0, positions: 0 };
        if (projectionRefreshPending) {
          const cursor = await store.cursor(config.indexerChainId, 'm6-indexer');
          if (cursor) projection = await m7Refresher.refreshAt(cursor.blockNumber);
          projectionRefreshPending = false;
        }
        failures = 0;
        log('info', 'indexer_batch', {
          from: result.from?.toString(),
          to: result.to?.toString(),
          logs: result.logs,
          projectedVaults: projection.vaults,
          projectedPositions: projection.positions,
        });
        if (!leaseHealthy) throw new Error('Indexer lease heartbeat failed');
        // While behind the head, immediately request the next bounded batch.
        // Normal polling begins only once runOnce reports no range.
        if (result.to !== undefined) continue;
      } catch (error) {
        failures++;
        log('error', 'indexer_batch_failed', {
          errorType: error instanceof Error ? error.name : 'unknown',
          ...(error instanceof IndexerRpcOperationError
            ? {
                rpcOperation: error.operation,
                rpcFromBlock: error.fromBlock?.toString(),
                rpcToBlock: error.toBlock?.toString(),
                rpcCode: error.rpcCode,
                rpcCauseType: error.cause instanceof Error ? error.cause.name : 'unknown',
              }
            : {}),
          failures,
        });
        if (
          error instanceof Error &&
          [
            'REORG_RECOVERY_LIMIT_EXCEEDED',
            'Indexer lease heartbeat failed',
            'Indexer lease lost',
            'INDEXER_FENCE_LOST',
          ].includes(error.message)
        )
          throw error;
      }
      await delayOrAbort(indexerRetryDelay(pollIntervalMs, failures), stopController.signal);
    }
  } catch (error) {
    terminalError = error;
    throw error;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (store && fenceToken !== undefined) {
      try {
        const status = stopping && terminalError === undefined ? 'STOPPED' : 'DEGRADED';
        const lastError =
          status === 'STOPPED' ? null : terminalError instanceof Error ? terminalError.name : 'unknown';
        await store.finishWorker(config.indexerChainId, 'm6-indexer', fenceToken, status, lastError);
        log('info', 'indexer_status_updated', { status });
      } catch (error) {
        process.exitCode = 1;
        log('error', 'indexer_status_update_failed', {
          errorType: error instanceof Error ? error.name : 'unknown',
        });
      }
    }
    const cleanups: { name: string; operation: Promise<unknown> }[] = [];
    if (leaseAcquired && coordination)
      cleanups.push({ name: 'lease', operation: coordination.release(leaseKey, leaseOwner) });
    if (redis) cleanups.push({ name: 'redis', operation: redis.quit() });
    cleanups.push({ name: 'postgres', operation: pool.end() });
    const cleanupResults = await Promise.allSettled(cleanups.map(({ operation }) => operation));
    for (const [index, result] of cleanupResults.entries()) {
      const { name } = cleanups[index]!;
      if (result.status === 'rejected') {
        process.exitCode = 1;
        log('error', 'indexer_cleanup_failed', {
          dependency: name,
          errorType: result.reason instanceof Error ? result.reason.name : 'unknown',
        });
      } else if (name === 'lease' && result.value !== true) {
        log('warn', 'indexer_lease_release_not_confirmed');
      }
    }
    log('info', 'indexer_stopped');
  }
}
void start().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'indexer_start_failed',
      errorType: error instanceof Error ? error.name : 'unknown',
    }),
  );
  process.exitCode = 1;
});
