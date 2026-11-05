import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { loadConfig } from '../dist/apps/api/src/config/env.js';

const expected = [
  'vortexa_schema_migrations',
  'deployments',
  'capabilities',
  'vaults',
  'config_versions',
  'headers',
  'raw_logs',
  'cursors',
  'balances',
  'transactions',
  'sessions',
  'audit_events',
  'outbox',
  'keeper_jobs',
  'reorg_journal',
  'reconciliation_results',
  'indexer_worker_state',
  'm7_projection_state',
  'm7_projection_events',
  'v2_pools',
  'v2_tokens',
  'v2_vault_bands',
  'v2_activities',
  'v2_rebalances',
  'v2_fee_collections',
  'v2_vault_snapshots',
  'v2_prices',
];
const expectedMigrations = [
  '0001_m0_m5_foundation',
  '0002_m6_indexer',
  '0003_m5_outbox_m6_fencing',
  '0004_m7_vault_catalog',
  '0005_v2_ui_read_models',
];
const config = loadConfig(undefined, undefined, 'tool');
if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 10000 });
try {
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY table_name`,
    [expected],
  );
  const names = new Set(tables.rows.map((row) => row.table_name));
  console.log(`Production schema tables present: ${names.size}/${expected.length}`);
  console.log(`Migration ledger present: ${names.has('vortexa_schema_migrations')}`);
  let migrationVersions = [];
  if (names.has('vortexa_schema_migrations')) {
    const migrations = await pool.query(
      'SELECT version FROM public.vortexa_schema_migrations ORDER BY applied_at',
    );
    migrationVersions = migrations.rows.map((row) => row.version);
    console.log(`Applied migration versions: ${migrationVersions.join(',') || 'none'}`);
  }
  const appliedChecksums = names.has('vortexa_schema_migrations')
    ? await pool.query('SELECT version,checksum FROM public.vortexa_schema_migrations')
    : { rows: [] };
  const checksumByVersion = new Map(
    appliedChecksums.rows.map((row) => [String(row.version), String(row.checksum)]),
  );
  let checksumsValid = true;
  for (const version of expectedMigrations) {
    const expectedChecksum = createHash('sha256')
      .update(await readFile(resolve('packages/adapters/migrations', `${version}.sql`), 'utf8'))
      .digest('hex');
    if (checksumByVersion.get(version) !== expectedChecksum) checksumsValid = false;
  }
  const migrationsComplete = expectedMigrations.every((version) => migrationVersions.includes(version));
  console.log(`Required migrations present: ${migrationsComplete}`);
  console.log(`Applied migration checksums valid: ${checksumsValid}`);
  process.exitCode = names.size === expected.length && migrationsComplete && checksumsValid ? 0 : 2;
} finally {
  await pool.end();
}
