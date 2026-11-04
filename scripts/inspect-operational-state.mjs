import pg from 'pg';
import { loadConfig } from '../dist/apps/api/src/config/env.js';

const config = loadConfig(undefined, undefined, 'tool');
if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 1,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
  query_timeout: 11000,
  application_name: 'vortexa-operational-inspector',
});

try {
  const [cursor, worker, outbox, projection] = await Promise.all([
    pool.query(
      `SELECT consumer,block_number::text AS block_number,updated_at
       FROM cursors WHERE chain_id=$1 ORDER BY consumer`,
      [config.chainId],
    ),
    pool.query(
      `SELECT consumer,status,fence_token::text AS fence_token,last_success_at,updated_at
       FROM indexer_worker_state WHERE chain_id=$1 ORDER BY consumer`,
      [config.chainId],
    ),
    pool.query(
      `SELECT
         count(*) FILTER (WHERE processed_at IS NULL AND dead_lettered_at IS NULL) AS pending,
         count(*) FILTER (WHERE dead_lettered_at IS NOT NULL) AS dead_lettered,
         extract(epoch FROM (now()-min(created_at) FILTER
           (WHERE processed_at IS NULL AND dead_lettered_at IS NULL))) AS oldest_pending_seconds
       FROM outbox`,
    ),
    pool.query(
      `SELECT indexed_through_block::text AS indexed_through_block,indexed_block_hash,
              finality,generation::text AS generation,updated_at
       FROM m7_projection_state WHERE chain_id=$1`,
      [config.chainId],
    ),
  ]);
  const outboxState = outbox.rows[0] ?? {};
  const blockers = [];
  if (worker.rows.some((row) => row.status === 'DEGRADED')) blockers.push('INDEXER_DEGRADED');
  if (Number(outboxState.dead_lettered ?? 0) > 0) blockers.push('OUTBOX_DEAD_LETTERS_PRESENT');
  if (Number(outboxState.oldest_pending_seconds ?? 0) > 300)
    blockers.push('OUTBOX_PENDING_OLDER_THAN_FIVE_MINUTES');
  if (projection.rows.length !== 1) blockers.push('PROJECTION_STATE_MISSING');
  console.log(
    JSON.stringify(
      {
        readOnly: true,
        status: blockers.length === 0 ? 'PASS' : 'BLOCKED',
        chainId: config.chainId,
        cursors: cursor.rows,
        workers: worker.rows,
        outbox: outboxState,
        projection: projection.rows[0] ?? null,
        blockers,
      },
      null,
      2,
    ),
  );
  if (blockers.length > 0) process.exitCode = 2;
} catch (error) {
  console.error(
    JSON.stringify({
      event: 'operational_state_inspection_failed',
      errorType: error instanceof Error ? error.name : 'unknown',
    }),
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
