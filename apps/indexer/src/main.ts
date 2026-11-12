import pg from 'pg';
import { loadConfig } from '../../api/src/config/env.js';
import {
  BlockchainIndexerService,
  delayOrAbort,
  indexerRetryDelay,
} from '../../../packages/application/src/blockchain-indexer.service.js';
import {
  AbiEventDecoder,
  IndexerRpcOperationError,
  ViemIndexerSource,
} from '../../../packages/adapters/src/indexer/viem-indexer-source.adapter.js';
import { PostgresIndexerStore } from '../../../packages/adapters/src/postgres/postgres-indexer.repository.js';
import {
  connectRedis,
  RedisCoordinationAdapter,
} from '../../../packages/adapters/src/redis-coordination.adapter.js';
import { chainScopedKey } from '../../../packages/adapters/src/chain-registry.js';
import { DrizzleVaultProjectionRepository } from '../../../packages/adapters/src/postgres/vault-projection.repository.js';
import { ViemPinnedVaultStateReader } from '../../../packages/adapters/src/pinned-projection.reader.js';
import { ProjectionRefreshService } from '../../../packages/application/src/projection-refresh.service.js';

// These values are persisted in Redis and PostgreSQL by existing deployments.
// Keep them stable even though their legacy labels no longer describe source-code organization.
const INDEXER_LEASE_RESOURCE = 'm6_indexer';
const INDEXER_CONSUMER = 'm6-indexer';

async function start() {
  const config = loadConfig(undefined, undefined, 'indexer');
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
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 60000,
    query_timeout: 65000,
    application_name: 'vortexa-indexer',
  });
  pool.on('error', (error) => log('error', 'postgres_pool_error', { errorType: error.name }));
  const leaseKey = chainScopedKey(config.indexerChainId, INDEXER_LEASE_RESOURCE);
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
    redis = await connectRedis(config.redisUrl, (error) =>
      log('error', 'redis_client_error', {
        errorType: error instanceof Error ? error.name : 'unknown',
      }),
    );
    coordination = new RedisCoordinationAdapter(redis);
    let nextLeaseWaitLogAt = 0;
    while (!stopping && !leaseAcquired) {
      leaseAcquired = await coordination.acquire(leaseKey, leaseOwner, leaseTtl);
      if (leaseAcquired) break;
      if (Date.now() >= nextLeaseWaitLogAt) {
        log('warn', 'indexer_waiting_for_lease', { retryInMs: 1000 });
        nextLeaseWaitLogAt = Date.now() + leaseTtl;
      }
      await delayOrAbort(1000, stopController.signal);
    }
    if (stopping) return;
    const source = new ViemIndexerSource(
      config.indexerChainId,
      config.rpcUrls,
      new AbiEventDecoder(config.contracts, config.manifest),
      config.indexerConfirmations,
    );
    store = new PostgresIndexerStore(pool);
    const vaultProjectionRepository = new DrizzleVaultProjectionRepository(pool);
    const projectionRefresher = new ProjectionRefreshService(
      config.indexerChainId,
      vaultProjectionRepository,
      new ViemPinnedVaultStateReader(config.rpcUrls, config.indexerChainId, config.contracts.VAULT_LENS),
      vaultProjectionRepository,
    );
    fenceToken = await store.acquireFence(config.indexerChainId, INDEXER_CONSUMER);
    const indexer = new BlockchainIndexerService(
      config.indexerChainId,
      INDEXER_CONSUMER,
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
          const cursor = await store.cursor(config.indexerChainId, INDEXER_CONSUMER);
          if (cursor) projection = await projectionRefresher.refreshAt(cursor.blockNumber);
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
                rpcCauseType: error.rpcCauseType,
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
        await store.finishWorker(config.indexerChainId, INDEXER_CONSUMER, fenceToken, status, lastError);
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
      errorCode: safeErrorCode(error),
      failureCategory: safeFailureCategory(error),
    }),
  );
  process.exitCode = 1;
});

// Keep diagnostics useful without logging database URLs, RPC paths, or raw messages.
function safeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : undefined;
}

function safeFailureCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return 'dependency_timeout';
  if (/ECONNREFUSED/i.test(message)) return 'connection_refused';
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return 'dns_failure';
  if (/password authentication|no pg_hba/i.test(message)) return 'database_access_denied';
  if (/relation .* does not exist|column .* does not exist|undefined_table|undefined_column/i.test(message))
    return 'database_schema_mismatch';
  return 'operation_failed';
}
