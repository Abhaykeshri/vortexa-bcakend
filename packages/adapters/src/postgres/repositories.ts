import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { Address, ChainId, Vault } from '../../../domain/src/types.js';
import type { AuditPort, VaultRepositoryPort } from '../../../domain/src/ports.js';

interface Queryable {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: QueryResultRow[]; rowCount: number | null }>;
}
export class PostgresVaultRepository implements VaultRepositoryPort {
  constructor(private readonly db: Queryable) {}
  async save(vault: Vault): Promise<void> {
    await this.db.query(
      `INSERT INTO vaults(chain_id,address,strategy,shape_id,owner_role,as_of_block) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(chain_id,address) DO UPDATE SET strategy=EXCLUDED.strategy,shape_id=EXCLUDED.shape_id,owner_role=EXCLUDED.owner_role,as_of_block=EXCLUDED.as_of_block,updated_at=now()
      WHERE vaults.as_of_block <= EXCLUDED.as_of_block`,
      [
        vault.chainId,
        vault.address.toLowerCase(),
        vault.strategy,
        vault.shapeId,
        vault.ownerRole,
        vault.asOfBlock.toString(),
      ],
    );
  }
  async find(chainId: ChainId, address: Address): Promise<Vault | null> {
    const result = await this.db.query(
      'SELECT chain_id,address,strategy,shape_id,owner_role,as_of_block FROM vaults WHERE chain_id=$1 AND address=$2',
      [chainId, address.toLowerCase()],
    );
    const row = result.rows[0] as
      | {
          chain_id: string;
          address: string;
          strategy: Vault['strategy'];
          shape_id: number | null;
          owner_role: Vault['ownerRole'];
          as_of_block: string;
        }
      | undefined;
    return row && row.shape_id !== null
      ? {
          chainId: Number(row.chain_id),
          address: row.address as Address,
          strategy: row.strategy,
          shapeId: row.shape_id,
          ownerRole: row.owner_role,
          asOfBlock: BigInt(row.as_of_block),
        }
      : null;
  }
}

export class PostgresAuditAdapter implements AuditPort {
  constructor(private readonly db: Queryable) {}
  async record(event: { action: string; chainId: ChainId; target: Address; outcome: string }): Promise<void> {
    await this.db.query('INSERT INTO audit_events(action,target,outcome,detail) VALUES($1,$2,$3,$4::jsonb)', [
      event.action,
      event.target.toLowerCase(),
      event.outcome,
      JSON.stringify({ chainId: event.chainId }),
    ]);
  }
}

export class DurableWorkRepository {
  constructor(private readonly pool: Pool) {}
  async enqueue(topic: string, idempotencyKey: string, payload: unknown): Promise<boolean> {
    const result = await this.pool.query(
      'INSERT INTO outbox(topic,idempotency_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(idempotency_key) DO NOTHING',
      [topic, idempotencyKey, JSON.stringify(payload)],
    );
    return result.rowCount === 1;
  }
  async claimOutbox(
    owner: string,
    limit = 25,
  ): Promise<readonly { id: string; topic: string; payload: unknown; attempts: number }[]> {
    if (!/^[a-zA-Z0-9._-]{1,160}$/.test(owner) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Invalid outbox claim');
    const result = await this.pool.query<{ id: string; topic: string; payload: unknown; attempts: number }>(
      `WITH candidates AS (
         SELECT id FROM outbox
         WHERE processed_at IS NULL AND dead_lettered_at IS NULL AND available_at <= now()
           AND (claim_until IS NULL OR claim_until <= now())
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE outbox AS o
       SET attempts=o.attempts+1,claim_owner=$2,claim_until=now()+interval '5 minutes'
       FROM candidates AS c WHERE o.id=c.id
       RETURNING o.id,o.topic,o.payload,o.attempts-1 AS attempts`,
      [limit, owner],
    );
    return result.rows;
  }
  async completeOutbox(id: string, owner: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE outbox SET processed_at=now(),last_error=NULL,claim_owner=NULL,claim_until=NULL
       WHERE id=$1 AND claim_owner=$2 AND claim_until>now() AND processed_at IS NULL`,
      [id, owner],
    );
    if (result.rowCount !== 1) throw new Error('Outbox claim lost before completion');
  }
  async retryOutbox(id: string, error: string, delaySeconds: number): Promise<void> {
    await this.pool.query(
      `UPDATE outbox SET last_error=$2,available_at=now()+($3 * interval '1 second') WHERE id=$1`,
      [id, error.slice(0, 500), Math.max(1, Math.min(delaySeconds, 3600))],
    );
  }
  async failOutbox(
    id: string,
    owner: string,
    error: string,
    maxAttempts: number,
    delaySeconds: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100)
      throw new Error('Invalid max attempts');
    const result = await this.pool.query(
      `UPDATE outbox SET last_error=$2,
       dead_lettered_at=CASE WHEN attempts >= $3 THEN now() ELSE dead_lettered_at END,
       available_at=CASE WHEN attempts >= $3 THEN available_at ELSE now()+($4 * interval '1 second') END,
       claim_owner=NULL,claim_until=NULL
       WHERE id=$1 AND claim_owner=$5 AND claim_until>now() AND processed_at IS NULL`,
      [id, error.slice(0, 500), maxAttempts, Math.max(1, Math.min(delaySeconds, 3600)), owner],
    );
    if (result.rowCount !== 1) throw new Error('Outbox claim lost before failure update');
  }
  async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
