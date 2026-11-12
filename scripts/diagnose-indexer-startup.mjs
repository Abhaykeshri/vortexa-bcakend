import pg from 'pg';
import { createClient } from 'redis';
import { loadConfig } from '../dist/apps/api/src/config/env.js';

const config = loadConfig(undefined, undefined, 'tool');
const result = {};

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 1,
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
  application_name: 'vortexa-indexer-diagnostic',
});
try {
  const tables = await pool.query(
    `SELECT
       to_regclass('public.indexer_worker_state') AS worker,
       to_regclass('public.cursors') AS cursors`,
  );
  result.postgres = {
    ok: true,
    workerTable: Boolean(tables.rows[0]?.worker),
    cursorTable: Boolean(tables.rows[0]?.cursors),
  };
} catch (error) {
  result.postgres = {
    ok: false,
    errorType: error instanceof Error ? error.name : 'unknown',
    ...(typeof error?.code === 'string' ? { errorCode: error.code } : {}),
  };
} finally {
  await pool.end().catch(() => undefined);
}

const redis = createClient({
  url: config.redisUrl,
  socket: { connectTimeout: 5000, reconnectStrategy: false },
});
redis.on('error', () => undefined);
try {
  await redis.connect();
  const leaseKey = `vortexa:v1:lease:chain_${config.chainId}_m6_indexer`;
  const [exists, ttlMs] = await Promise.all([redis.exists(leaseKey), redis.pTTL(leaseKey)]);
  result.redis = { ok: true, indexerLeaseExists: exists === 1, indexerLeaseTtlMs: ttlMs };
} catch (error) {
  result.redis = {
    ok: false,
    errorType: error instanceof Error ? error.name : 'unknown',
    ...(typeof error?.code === 'string' ? { errorCode: error.code } : {}),
  };
} finally {
  if (redis.isOpen) await redis.quit().catch(() => undefined);
}

try {
  const response = await fetch(config.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    signal: globalThis.AbortSignal.timeout(5000),
  });
  const payload = await response.json();
  const reportedChainId = typeof payload?.result === 'string' ? Number(BigInt(payload.result)) : null;
  result.rpc = {
    ok: response.ok && reportedChainId === config.chainId,
    httpStatus: response.status,
    chainMatches: reportedChainId === config.chainId,
  };
} catch (error) {
  result.rpc = { ok: false, errorType: error instanceof Error ? error.name : 'unknown' };
}

console.log(JSON.stringify({ readOnly: true, ...result }, null, 2));
if (!result.postgres?.ok || !result.redis?.ok || !result.rpc?.ok) process.exitCode = 1;
