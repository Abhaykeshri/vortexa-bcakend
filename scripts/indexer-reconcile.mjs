import pg from 'pg';
import { loadConfig } from '../dist/apps/api/src/config/env.js';
import { PostgresIndexerStore } from '../dist/packages/adapters/src/postgres/indexer-store.js';
const config = loadConfig();
if (!config.databaseUrl || !config.indexerChainId) throw new Error('Indexer database configuration required');
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 1,
  application_name: 'vortexa-reconcile',
});
try {
  const result = await new PostgresIndexerStore(pool).reconcile(config.indexerChainId, 'm6-indexer');
  console.log(
    JSON.stringify({
      chainId: config.indexerChainId,
      manifestVersion: config.manifestVersion,
      ...result,
      cursor: result.cursor?.toString() ?? null,
      fromBlock: result.fromBlock?.toString() ?? null,
      toBlock: result.toBlock?.toString() ?? null,
    }),
  );
  if (!result.ok) process.exitCode = 1;
} finally {
  await pool.end();
}
