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
];
const expectedMigrations = [
  '0001_m0_m5_foundation',
  '0002_m6_indexer',
  '0003_m5_outbox_m6_fencing',
  '0004_m7_vault_catalog',
];
const config = loadConfig();
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
  const migrationsComplete = expectedMigrations.every((version) => migrationVersions.includes(version));
  console.log(`Required migrations present: ${migrationsComplete}`);
  process.exitCode = names.size === expected.length && migrationsComplete ? 0 : 2;
} finally {
  await pool.end();
}
