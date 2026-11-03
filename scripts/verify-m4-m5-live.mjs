import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createClient } from 'redis';
import { loadConfig } from '../dist/apps/api/src/config/env.js';

const config = loadConfig();
if (!config.databaseUrl || !config.redisUrl) throw new Error('DATABASE_URL and REDIS_URL are required');
const suffix = randomUUID().replaceAll('-', '');
const schema = `vortexa_verify_${suffix}`;
if (!/^vortexa_verify_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe verification schema');
const migration = await readFile('packages/adapters/migrations/0001_m0_m5_foundation.sql', 'utf8');
const checksum = createHash('sha256').update(migration).digest('hex');
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 3,
  connectionTimeoutMillis: 10000,
  application_name: 'vortexa-live-verifier',
});
try {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(
      'CREATE TABLE vortexa_schema_migrations(version text PRIMARY KEY, checksum text NOT NULL)',
    );
    const applyMigration = async () => {
      const applied = await client.query('SELECT checksum FROM vortexa_schema_migrations WHERE version=$1', [
        '0001_m0_m5_foundation',
      ]);
      if (applied.rows[0]) {
        if (applied.rows[0].checksum !== checksum) throw new Error('Migration checksum mismatch');
        return false;
      }
      await client.query('BEGIN');
      try {
        await client.query(migration);
        await client.query('INSERT INTO vortexa_schema_migrations(version,checksum) VALUES($1,$2)', [
          '0001_m0_m5_foundation',
          checksum,
        ]);
        await client.query('COMMIT');
        return true;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    };
    if (!(await applyMigration()) || (await applyMigration()))
      throw new Error('Migration repeat was not a no-op');
    const address = config.contracts.VAULT.toLowerCase();
    await client.query(
      'INSERT INTO vaults(chain_id,address,strategy,shape_id,owner_role,as_of_block) VALUES($1,$2,$3,$4,$5,$6)',
      [config.chainId, address, 'NormalLP', 3, 'GOVERNANCE_ONLY', '123456789012345678901'],
    );
    const read = await client.query('SELECT as_of_block FROM vaults WHERE chain_id=$1 AND address=$2', [
      config.chainId,
      address,
    ]);
    if (read.rows[0]?.as_of_block !== '123456789012345678901')
      throw new Error('PostgreSQL bigint CRUD mismatch');
    await client.query('UPDATE vaults SET shape_id=$1 WHERE chain_id=$2 AND address=$3', [
      4,
      config.chainId,
      address,
    ]);
    await client.query('BEGIN');
    await client.query('DELETE FROM vaults WHERE chain_id=$1', [config.chainId]);
    await client.query('ROLLBACK');
    if ((await client.query('SELECT count(*)::int AS count FROM vaults')).rows[0]?.count !== 1)
      throw new Error('PostgreSQL rollback failed');
    let duplicateRejected = false;
    try {
      await client.query(
        'INSERT INTO vaults(chain_id,address,strategy,shape_id,owner_role,as_of_block) VALUES($1,$2,$3,$4,$5,$6)',
        [config.chainId, address, 'NormalLP', 3, 'GOVERNANCE_ONLY', '1'],
      );
    } catch (error) {
      duplicateRejected = error?.code === '23505';
    }
    if (!duplicateRejected) throw new Error('PostgreSQL duplicate constraint failed');
    const outboxTable = `"${schema}".outbox`;
    const inserts = await Promise.all(
      [1, 2].map(() =>
        pool.query(
          `INSERT INTO ${outboxTable}(topic,idempotency_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(idempotency_key) DO NOTHING`,
          ['verify', `verify-${suffix}`, '{}'],
        ),
      ),
    );
    if (inserts.reduce((sum, result) => sum + (result.rowCount ?? 0), 0) !== 1)
      throw new Error('PostgreSQL concurrent idempotency failed');
    await client.query('DELETE FROM vaults WHERE chain_id=$1 AND address=$2', [config.chainId, address]);
    console.log('PostgreSQL migration-repeat/CRUD/constraints/concurrency/rollback: PASS');
  } finally {
    client.release();
  }
} finally {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await pool.end();
}

const redis = createClient({
  url: config.redisUrl,
  socket: { connectTimeout: 10000, reconnectStrategy: false },
});
redis.on('error', () => {});
const prefix = `vortexa:verify:${suffix}`;
const keys = [`${prefix}:value`, `${prefix}:lease`, `${prefix}:rate`];
try {
  await redis.connect();
  await redis.set(keys[0], JSON.stringify({ ok: true }), { EX: 30 });
  if (!(await redis.get(keys[0])) || (await redis.ttl(keys[0])) <= 0)
    throw new Error('Redis value/TTL failed');
  if ((await redis.set(keys[1], 'worker-a', { NX: true, PX: 250 })) !== 'OK')
    throw new Error('Redis lease failed');
  if ((await redis.set(keys[1], 'worker-b', { NX: true, PX: 5000 })) !== null)
    throw new Error('Redis duplicate lease allowed');
  await redis.incr(keys[2]);
  await redis.expire(keys[2], 30);
  await new Promise((resolve) => setTimeout(resolve, 350));
  if ((await redis.set(keys[1], 'worker-b', { NX: true, PX: 5000 })) !== 'OK')
    throw new Error('Redis expired lease takeover failed');
  await redis.close();
  await redis.connect();
  if ((await redis.ping()) !== 'PONG') throw new Error('Redis reconnect failed');
  console.log('Redis value/TTL/idempotent lease/expiry takeover/reconnect: PASS');
} finally {
  if (redis.isOpen) {
    await redis.del(keys).catch(() => {});
    await redis.close();
  }
}
