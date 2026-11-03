import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../dist/apps/api/src/config/env.js';

const config = loadConfig();
if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
const direction = process.argv[2] === 'down' ? 'down' : 'up';
if (direction === 'down' && process.env.ALLOW_MIGRATION_DOWN !== 'true')
  throw new Error('Set ALLOW_MIGRATION_DOWN=true to run destructive rollback');
const file = direction === 'down' ? '0001_m0_m5_foundation.down.sql' : '0001_m0_m5_foundation.sql';
const sql = await readFile(resolve('packages/adapters/migrations', file), 'utf8');
const version = '0001_m0_m5_foundation';
const checksum = createHash('sha256')
  .update(await readFile(resolve('packages/adapters/migrations', '0001_m0_m5_foundation.sql'), 'utf8'))
  .digest('hex');
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
  const applied = await client.query('SELECT checksum FROM vortexa_schema_migrations WHERE version=$1', [
    version,
  ]);
  if (direction === 'up' && applied.rows[0]) {
    if (applied.rows[0].checksum !== checksum) throw new Error('Applied migration checksum mismatch');
    console.log('Migration already applied; no changes made');
  } else {
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
      console.log(`Migration ${direction} completed`);
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
