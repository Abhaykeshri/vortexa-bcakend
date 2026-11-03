import pg from 'pg';
import { loadConfig } from '../../api/src/config/env.js';
import { OutboxWorker } from '../../../packages/application/src/outbox-worker.js';
import { DurableWorkRepository } from '../../../packages/adapters/src/postgres/repositories.js';
import { connectRedis, RedisCoordinationAdapter } from '../../../packages/adapters/src/redis-coordination.js';

async function start() {
  const config = loadConfig();
  if (!config.databaseUrl || !config.redisUrl)
    throw new Error('Outbox worker requires DATABASE_URL and REDIS_URL');
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 2,
    application_name: 'vortexa-outbox',
  });
  let redis: Awaited<ReturnType<typeof connectRedis>> | undefined;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const log = (event: string, detail: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...detail }));
  try {
    redis = await connectRedis(config.redisUrl);
    const worker = new OutboxWorker(new DurableWorkRepository(pool), new RedisCoordinationAdapter(redis));
    const owner = RedisCoordinationAdapter.leaseOwner('outbox');
    let failures = 0;
    while (!controller.signal.aborted) {
      try {
        const result = await worker.runOnce(owner);
        failures = 0;
        if (result.processed === 0 && result.failed === 0) await wait(1000, controller.signal);
      } catch (error) {
        failures++;
        log('outbox_batch_failed', {
          errorType: error instanceof Error ? error.name : 'unknown',
          failures,
        });
        await wait(Math.min(1000 * 2 ** Math.min(failures - 1, 5), 30000), controller.signal);
      }
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    const cleanup = await Promise.allSettled([...(redis ? [redis.quit()] : []), pool.end()]);
    for (const result of cleanup) {
      if (result.status === 'rejected') {
        process.exitCode = 1;
        log('outbox_cleanup_failed', {
          errorType: result.reason instanceof Error ? result.reason.name : 'unknown',
        });
      }
    }
    log('outbox_worker_stopped');
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
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

void start().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'outbox_start_failed',
      errorType: error instanceof Error ? error.name : 'unknown',
    }),
  );
  process.exitCode = 1;
});
