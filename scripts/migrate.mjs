import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../dist/apps/api/src/config/env.js';
const config = loadConfig(undefined, undefined, 'tool');
if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
const direction = process.argv[2] === 'down' ? 'down' : 'up';
if (direction === 'down' && process.env.ALLOW_MIGRATION_DOWN !== 'true')
  throw new Error('Set ALLOW_MIGRATION_DOWN=true to run destructive rollback');
const migrations = [
  '0001_m0_m5_foundation',
  '0002_m6_indexer',
  '0003_m5_outbox_m6_fencing',
  '0004_m7_vault_catalog',
  '0005_v2_ui_read_models',
];
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10000,
  application_name: 'vortexa-migrator',
});
const client = await pool.connect();
try {
  await client.query('SELECT pg_advisory_lock($1)', [813_711_551_11]);
  await client.query(
    'CREATE TABLE IF NOT EXISTS vortexa_schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const selected = direction === 'up' ? migrations : [migrations.at(-1)];
  for (const version of selected) {
    const upPath = resolve('packages/adapters/migrations', `${version}.sql`);
    const checksum = createHash('sha256')
      .update(await readFile(upPath, 'utf8'))
      .digest('hex');
    const applied = await client.query('SELECT checksum FROM vortexa_schema_migrations WHERE version=$1', [
      version,
    ]);
    if (direction === 'up' && applied.rows[0]) {
      if (applied.rows[0].checksum !== checksum)
        throw new Error(`Applied migration checksum mismatch: ${version}`);
      console.log(`Migration already applied: ${version}`);
      continue;
    }
    if (direction === 'down' && !applied.rows[0]) {
      console.log(`Migration not applied: ${version}`);
      continue;
    }
    const sql = await readFile(
      direction === 'up' ? upPath : resolve('packages/adapters/migrations', `${version}.down.sql`),
      'utf8',
    );
    await client.query('BEGIN');
    try {
      await client.query(sql);
      if (direction === 'up')
        await client.query('INSERT INTO vortexa_schema_migrations(version,checksum) VALUES($1,$2)', [
          version,
          checksum,
        ]);
      else await client.query('DELETE FROM vortexa_schema_migrations WHERE version=$1', [version]);
      await client.query('COMMIT');
      console.log(`Migration ${direction}: ${version}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock($1)', [813_711_551_11]).catch(() => {});
  client.release();
  await pool.end();
}
