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
  if (names.has('vortexa_schema_migrations')) {
    const migrations = await pool.query(
      'SELECT version FROM public.vortexa_schema_migrations ORDER BY applied_at',
    );
    console.log(
      `Applied migration versions: ${migrations.rows.map((row) => row.version).join(',') || 'none'}`,
    );
  }
  process.exitCode = names.size === expected.length ? 0 : 2;
} finally {
  await pool.end();
}
