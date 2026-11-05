import type { Pool, PoolClient } from 'pg';
import type { ChainId } from '../../../domain/src/types.js';
import type {
  IndexedHeader,
  IndexedLog,
  IndexerCursor,
  IndexerStore,
} from '../../../application/src/blockchain-indexer.service.js';

function eventString(value: unknown): string {
  return typeof value === 'string' || typeof value === 'bigint' ? value.toString() : '';
}

function eventInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER))
    return Number(value);
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

/**
 * PostgreSQL indexer store implementing fenced batch commits, deterministic
 * reorg rollback, projection updates, finality promotion, and reconciliation.
 */
export class PostgresIndexerStore implements IndexerStore {
  constructor(private readonly pool: Pool) {}
  async trackedAddresses(chainId: ChainId) {
    const result = await this.pool.query<{ address: string }>(
      'SELECT address FROM vaults WHERE chain_id=$1 AND factory_address IS NOT NULL ORDER BY address',
      [chainId],
    );
    return result.rows
      .map((row) => row.address.toLowerCase())
      .filter((value): value is `0x${string}` => /^0x[a-f0-9]{40}$/.test(value));
  }

  private async applyBalanceDelta(
    client: PoolClient,
    log: IndexedLog,
    wallet: string,
    delta: bigint,
  ): Promise<void> {
    if (delta === 0n) return;
    if (delta > 0n) {
      await client.query(
        `INSERT INTO balances(chain_id,vault_address,wallet_address,shares,as_of_block,finality,indexed_block_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(chain_id,vault_address,wallet_address) DO UPDATE
         SET shares=balances.shares+EXCLUDED.shares,as_of_block=EXCLUDED.as_of_block,
             finality=EXCLUDED.finality,indexed_block_hash=EXCLUDED.indexed_block_hash,updated_at=now()`,
        [
          log.chainId,
          log.address.toLowerCase(),
          wallet,
          delta.toString(),
          log.blockNumber.toString(),
          log.finality,
          log.blockHash,
        ],
      );
      return;
    }
    const result = await client.query(
      `UPDATE balances SET shares=shares+$4,as_of_block=$5,finality=$6,indexed_block_hash=$7,updated_at=now()
       WHERE chain_id=$1 AND vault_address=$2 AND wallet_address=$3 AND shares >= $8`,
      [
        log.chainId,
        log.address.toLowerCase(),
        wallet,
        delta.toString(),
        log.blockNumber.toString(),
        log.finality,
        log.blockHash,
        (-delta).toString(),
      ],
    );
    if (result.rowCount !== 1) throw new Error('POSITION_UNDERFLOW');
  }

  private async applyProjectionLog(client: PoolClient, log: IndexedLog): Promise<void> {
    await this.applyV2ReadModelLog(client, log);
    if (log.eventName !== 'VaultCreated' && log.eventName !== 'Transfer') return;
    const claimed = await client.query(
      `INSERT INTO m7_projection_events(chain_id,transaction_hash,log_index,block_hash,event_name,canonical)
       VALUES($1,$2,$3,$4,$5,true)
       ON CONFLICT(chain_id,transaction_hash,log_index,block_hash) DO UPDATE SET canonical=true
       WHERE m7_projection_events.canonical=false RETURNING 1`,
      [log.chainId, log.transactionHash, log.logIndex, log.blockHash, log.eventName],
    );
    if (claimed.rowCount !== 1) return;
    const args =
      log.eventArgs && typeof log.eventArgs === 'object' && !Array.isArray(log.eventArgs)
        ? (log.eventArgs as Record<string, unknown>)
        : {};
    if (log.eventName === 'VaultCreated') {
      const vault = eventString(args.vault).toLowerCase();
      const creator = eventString(args.creator).toLowerCase();
      const poolId = eventString(args.poolId).toLowerCase();
      const strategyContract = eventString(args.strategyContract).toLowerCase();
      const strategyValue = eventInteger(args.strategy);
      const strategy = strategyValue === null ? undefined : ['NormalLP', 'BuyDip', 'SellPump'][strategyValue];
      if (
        !/^0x[a-f0-9]{40}$/.test(vault) ||
        !/^0x[a-f0-9]{40}$/.test(creator) ||
        !/^0x[a-f0-9]{64}$/.test(poolId) ||
        !/^0x[a-f0-9]{40}$/.test(strategyContract) ||
        !strategy
      )
        throw new Error('VAULT_CREATED_ARGS_INVALID');
      await client.query(
        `INSERT INTO vaults(chain_id,address,strategy,shape_id,owner_role,as_of_block,config,
          factory_address,creator,creation_transaction_hash,creation_block,pool_id,strategy_contract,
          total_shares,accounting_available,finality,indexed_through_block,indexed_block_hash)
         VALUES($1,$2,$3,NULL,'GOVERNANCE_ONLY',$4,$5::jsonb,$6,$7,$8,$4,$9,$10,0,false,$11,$4,$12)
         ON CONFLICT(chain_id,address) DO UPDATE SET
          factory_address=EXCLUDED.factory_address,creator=EXCLUDED.creator,
          creation_transaction_hash=EXCLUDED.creation_transaction_hash,creation_block=EXCLUDED.creation_block,
          pool_id=EXCLUDED.pool_id,strategy=EXCLUDED.strategy,strategy_contract=EXCLUDED.strategy_contract,
          finality=EXCLUDED.finality,indexed_through_block=EXCLUDED.indexed_through_block,
          indexed_block_hash=EXCLUDED.indexed_block_hash,updated_at=now()`,
        [
          log.chainId,
          vault,
          strategy,
          log.blockNumber.toString(),
          JSON.stringify({ availability: 'PINNED_READ_REQUIRED' }),
          log.address.toLowerCase(),
          creator,
          log.transactionHash,
          poolId,
          strategyContract,
          log.finality,
          log.blockHash,
        ],
      );
      return;
    }
    const known = await client.query(
      'SELECT 1 FROM vaults WHERE chain_id=$1 AND address=$2 AND factory_address IS NOT NULL',
      [log.chainId, log.address.toLowerCase()],
    );
    if (known.rowCount !== 1) return;
    const from = eventString(args.from).toLowerCase();
    const to = eventString(args.to).toLowerCase();
    const rawValue = eventString(args.value);
    if (!/^0x[a-f0-9]{40}$/.test(from) || !/^0x[a-f0-9]{40}$/.test(to) || !/^[0-9]+$/.test(rawValue))
      throw new Error('TRANSFER_ARGS_INVALID');
    const value = BigInt(rawValue);
    const zero = '0x0000000000000000000000000000000000000000';
    if (from !== zero) await this.applyBalanceDelta(client, log, from, -value);
    if (to !== zero) await this.applyBalanceDelta(client, log, to, value);
    const supplyDelta = from === zero ? value : to === zero ? -value : 0n;
    if (supplyDelta !== 0n) {
      const result = await client.query(
        `UPDATE vaults SET total_shares=total_shares+$3,as_of_block=$4,
         indexed_through_block=$4,indexed_block_hash=$5,updated_at=now()
         WHERE chain_id=$1 AND address=$2 AND total_shares >= $6`,
        [
          log.chainId,
          log.address.toLowerCase(),
          supplyDelta.toString(),
          log.blockNumber.toString(),
          log.blockHash,
          supplyDelta < 0n ? (-supplyDelta).toString() : '0',
        ],
      );
      if (result.rowCount !== 1) throw new Error('VAULT_SUPPLY_UNDERFLOW');
    }
  }

  /** Projects decoded V2 events into reorg-safe UI read models. The unique key
   * includes block hash so a replacement block cannot overwrite history. */
  private async applyV2ReadModelLog(client: PoolClient, log: IndexedLog): Promise<void> {
    const args = log.eventArgs && typeof log.eventArgs === 'object' && !Array.isArray(log.eventArgs)
      ? (log.eventArgs as Record<string, unknown>) : {};
    const candidate = eventString(args.vault) || log.address;
    const vault = candidate.toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(vault)) return;
    if (log.eventName !== 'VaultCreated') {
      const known = await client.query('SELECT 1 FROM vaults WHERE chain_id=$1 AND address=$2', [log.chainId, vault]);
      if (known.rowCount !== 1) return;
    }
    const actor = (eventString(args.actor) || eventString(args.sender) || eventString(args.owner) || eventString(args.from) || null)?.toLowerCase() ?? null;
    const receiver = (eventString(args.receiver) || eventString(args.to) || null)?.toLowerCase() ?? null;
    const safe = (value: unknown): string | null => {
      if (value === undefined || value === null) return null;
      if (typeof value === 'bigint' || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
      return null;
    };
    const amounts = JSON.stringify(Object.fromEntries(Object.entries(args).filter(([key]) => /amount|value|liquidity|shares|fee/i.test(key)).map(([key, value]) => [key, safe(value)])));
    await client.query(
      `INSERT INTO v2_activities(chain_id,transaction_hash,log_index,block_hash,block_number,vault_address,kind,actor,receiver,amounts,finality,canonical)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,true)
       ON CONFLICT(chain_id,transaction_hash,log_index,block_hash) DO UPDATE SET canonical=true,finality=EXCLUDED.finality,kind=EXCLUDED.kind`,
      [log.chainId, log.transactionHash, log.logIndex, log.blockHash, log.blockNumber.toString(), vault, log.eventName, actor, receiver, amounts, log.finality],
    );
    if (log.eventName === 'Rebalanced') {
      await client.query(
        `INSERT INTO v2_rebalances(chain_id,transaction_hash,log_index,block_hash,vault_address,block_number,detail,finality,canonical)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,true)
         ON CONFLICT(chain_id,transaction_hash,log_index,block_hash) DO UPDATE SET canonical=true,finality=EXCLUDED.finality,detail=EXCLUDED.detail`,
        [log.chainId, log.transactionHash, log.logIndex, log.blockHash, vault, log.blockNumber.toString(), JSON.stringify(args, (_key: string, value: unknown): unknown => typeof value === 'bigint' ? value.toString() : value), log.finality],
      );
    }
    if (log.eventName === 'FeesCollected') {
      const num = (key: string) => safe(args[key]) ?? '0';
      await client.query(
        `INSERT INTO v2_fee_collections(chain_id,transaction_hash,log_index,block_hash,vault_address,amount0,amount1,protocol_fee0,protocol_fee1,block_number,finality,canonical)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
         ON CONFLICT(chain_id,transaction_hash,log_index,block_hash) DO UPDATE SET canonical=true,finality=EXCLUDED.finality`,
        [log.chainId, log.transactionHash, log.logIndex, log.blockHash, vault, num('amount0'), num('amount1'), num('protocolFee0'), num('protocolFee1'), log.blockNumber.toString(), log.finality],
      );
    }
  }

  private async advanceVaultProjection(
    client: PoolClient,
    headers: readonly IndexedHeader[],
    logs: readonly IndexedLog[],
  ): Promise<void> {
    for (const log of logs) await this.applyProjectionLog(client, log);
    const last = headers.at(-1)!;
    await client.query(
      `UPDATE vaults SET indexed_through_block=$2,indexed_block_hash=$3,updated_at=now()
       WHERE chain_id=$1 AND factory_address IS NOT NULL`,
      [last.chainId, last.number.toString(), last.hash],
    );
    await client.query(
      `INSERT INTO m7_projection_state(chain_id,generation,indexed_through_block,indexed_block_hash,finality)
       VALUES($1,1,$2,$3,$4)
       ON CONFLICT(chain_id) DO UPDATE SET generation=m7_projection_state.generation+1,
       indexed_through_block=EXCLUDED.indexed_through_block,indexed_block_hash=EXCLUDED.indexed_block_hash,
       finality=EXCLUDED.finality,updated_at=now()`,
      [last.chainId, last.number.toString(), last.hash, last.finality],
    );
  }

  private async reverseProjectionLog(client: PoolClient, log: IndexedLog): Promise<void> {
    const args =
      log.eventArgs && typeof log.eventArgs === 'object' && !Array.isArray(log.eventArgs)
        ? (log.eventArgs as Record<string, unknown>)
        : {};
    if (log.eventName === 'Transfer') {
      const from = eventString(args.from).toLowerCase();
      const to = eventString(args.to).toLowerCase();
      const rawValue = eventString(args.value);
      if (!/^0x[a-f0-9]{40}$/.test(from) || !/^0x[a-f0-9]{40}$/.test(to) || !/^[0-9]+$/.test(rawValue))
        throw new Error('TRANSFER_ARGS_INVALID');
      const value = BigInt(rawValue);
      const zero = '0x0000000000000000000000000000000000000000';
      if (to !== zero) await this.applyBalanceDelta(client, log, to, -value);
      if (from !== zero) await this.applyBalanceDelta(client, log, from, value);
      const supplyDelta = from === zero ? -value : to === zero ? value : 0n;
      if (supplyDelta !== 0n) {
        const result = await client.query(
          `UPDATE vaults SET total_shares=total_shares+$3,updated_at=now()
           WHERE chain_id=$1 AND address=$2 AND total_shares >= $4`,
          [
            log.chainId,
            log.address.toLowerCase(),
            supplyDelta.toString(),
            supplyDelta < 0n ? (-supplyDelta).toString() : '0',
          ],
        );
        if (result.rowCount !== 1) throw new Error('VAULT_SUPPLY_UNDERFLOW');
      }
    } else if (log.eventName === 'VaultCreated') {
      const vault = eventString(args.vault).toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(vault)) throw new Error('VAULT_CREATED_ARGS_INVALID');
      await client.query('DELETE FROM balances WHERE chain_id=$1 AND vault_address=$2', [log.chainId, vault]);
      await client.query('DELETE FROM vaults WHERE chain_id=$1 AND address=$2', [log.chainId, vault]);
    }
    await client.query(
      `UPDATE m7_projection_events SET canonical=false
       WHERE chain_id=$1 AND transaction_hash=$2 AND log_index=$3 AND block_hash=$4`,
      [log.chainId, log.transactionHash, log.logIndex, log.blockHash],
    );
  }
  async acquireFence(chainId: ChainId, consumer: string): Promise<bigint> {
    const result = await this.pool.query<{ fence_token: string }>(
      `INSERT INTO indexer_worker_state(chain_id,consumer,status,fence_token)
       VALUES($1,$2,'RUNNING',1)
       ON CONFLICT(chain_id,consumer) DO UPDATE
       SET fence_token=indexer_worker_state.fence_token+1,status='RUNNING',last_error=NULL,updated_at=now()
       RETURNING fence_token`,
      [chainId, consumer],
    );
    const token = result.rows[0]?.fence_token;
    if (!token) throw new Error('Indexer fence acquisition failed');
    return BigInt(token);
  }
  async finishWorker(
    chainId: ChainId,
    consumer: string,
    fenceToken: bigint,
    status: 'STOPPED' | 'DEGRADED',
    lastError: string | null,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE indexer_worker_state
       SET status=$4,last_error=$5,updated_at=now()
       WHERE chain_id=$1 AND consumer=$2 AND fence_token=$3`,
      [chainId, consumer, fenceToken.toString(), status, lastError],
    );
    if (result.rowCount !== 1) throw new Error('INDEXER_FENCE_LOST');
  }
  private async assertFence(
    client: PoolClient,
    chainId: ChainId,
    consumer: string,
    fenceToken: bigint,
  ): Promise<void> {
    const result = await client.query<{ fence_token: string }>(
      'SELECT fence_token FROM indexer_worker_state WHERE chain_id=$1 AND consumer=$2 FOR UPDATE',
      [chainId, consumer],
    );
    if (result.rows[0]?.fence_token !== fenceToken.toString()) throw new Error('INDEXER_FENCE_LOST');
  }
  async cursor(chainId: ChainId, consumer: string): Promise<IndexerCursor | null> {
    const r = await this.pool.query(
      'SELECT block_number,block_hash FROM cursors WHERE chain_id=$1 AND consumer=$2',
      [chainId, consumer],
    );
    const row = r.rows[0] as { block_number: string; block_hash: `0x${string}` } | undefined;
    return row ? { blockNumber: BigInt(row.block_number), blockHash: row.block_hash } : null;
  }
  async canonicalHeader(chainId: ChainId, blockNumber: bigint): Promise<IndexedHeader | null> {
    const r = await this.pool.query(
      `SELECT block_number,block_hash,parent_hash,extract(epoch from block_timestamp)::bigint AS timestamp,finality FROM headers WHERE chain_id=$1 AND block_number=$2 AND canonical=true`,
      [chainId, blockNumber.toString()],
    );
    const row = r.rows[0] as
      | {
          block_number: string;
          block_hash: `0x${string}`;
          parent_hash: `0x${string}`;
          timestamp: string;
          finality: IndexedHeader['finality'];
        }
      | undefined;
    return row
      ? {
          chainId,
          number: BigInt(row.block_number),
          hash: row.block_hash,
          parentHash: row.parent_hash,
          timestamp: BigInt(row.timestamp),
          finality: row.finality,
        }
      : null;
  }
  async commitBatch(
    consumer: string,
    fenceToken: bigint,
    headers: readonly IndexedHeader[],
    logs: readonly IndexedLog[],
  ): Promise<void> {
    if (!headers.length) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertFence(client, headers[0]!.chainId, consumer, fenceToken);
      await client.query(
        `INSERT INTO headers(chain_id,block_number,block_hash,parent_hash,block_timestamp,canonical,finality)
         SELECT x.chain_id,x.block_number,x.block_hash,x.parent_hash,to_timestamp(x.block_timestamp),true,x.finality
         FROM jsonb_to_recordset($1::jsonb) AS x(chain_id bigint,block_number numeric,block_hash text,parent_hash text,block_timestamp numeric,finality text)
         ON CONFLICT(chain_id,block_hash) DO UPDATE SET canonical=true,finality=EXCLUDED.finality`,
        [
          JSON.stringify(
            headers.map((h) => ({
              chain_id: h.chainId,
              block_number: h.number.toString(),
              block_hash: h.hash,
              parent_hash: h.parentHash,
              block_timestamp: h.timestamp.toString(),
              finality: h.finality,
            })),
          ),
        ],
      );
      if (logs.length)
        await client.query(
          `INSERT INTO raw_logs(chain_id,transaction_hash,transaction_index,log_index,block_hash,block_number,address,topics,data,event_name,event_args,canonical,finality)
           SELECT x.chain_id,x.transaction_hash,x.transaction_index,x.log_index,x.block_hash,x.block_number,x.address,x.topics,x.data,x.event_name,x.event_args,true,x.finality
           FROM jsonb_to_recordset($1::jsonb) AS x(chain_id bigint,transaction_hash text,transaction_index integer,log_index integer,block_hash text,block_number numeric,address text,topics jsonb,data text,event_name text,event_args jsonb,finality text)
           ON CONFLICT(chain_id,transaction_hash,log_index,block_hash) DO UPDATE SET canonical=true,finality=EXCLUDED.finality,event_name=EXCLUDED.event_name,event_args=EXCLUDED.event_args`,
          [
            JSON.stringify(
              logs.map((l) => ({
                chain_id: l.chainId,
                transaction_hash: l.transactionHash,
                transaction_index: l.transactionIndex,
                log_index: l.logIndex,
                block_hash: l.blockHash,
                block_number: l.blockNumber.toString(),
                address: l.address.toLowerCase(),
                topics: l.topics,
                data: l.data,
                event_name: l.eventName ?? null,
                event_args: l.eventArgs ?? null,
                finality: l.finality,
              })),
            ),
          ],
        );
      await this.advanceVaultProjection(client, headers, logs);
      const last = headers.at(-1)!;
      await client.query(
        `INSERT INTO cursors(chain_id,consumer,block_number,block_hash) VALUES($1,$2,$3,$4) ON CONFLICT(chain_id,consumer) DO UPDATE SET block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,updated_at=now()`,
        [last.chainId, consumer, last.number.toString(), last.hash],
      );
      await client.query(
        `UPDATE indexer_worker_state SET status='RUNNING',last_success_at=now(),last_error=NULL,updated_at=now()
         WHERE chain_id=$1 AND consumer=$2 AND fence_token=$3`,
        [last.chainId, consumer, fenceToken.toString()],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  async rollbackTo(
    chainId: ChainId,
    consumer: string,
    fenceToken: bigint,
    ancestor: IndexedHeader,
    depth: number,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertFence(client, chainId, consumer, fenceToken);
      const orphaned = await client.query<{ block_hash: string }>(
        `UPDATE headers SET canonical=false,finality='OBSERVED' WHERE chain_id=$1 AND canonical=true AND block_number>$2 RETURNING block_hash`,
        [chainId, ancestor.number.toString()],
      );
      const orphanedHashes = orphaned.rows.map((row) => row.block_hash);
      if (orphanedHashes.length) {
        const projectionLogs = await client.query<{
          transaction_hash: `0x${string}`;
          transaction_index: number;
          log_index: number;
          block_hash: `0x${string}`;
          block_number: string;
          address: `0x${string}`;
          topics: readonly `0x${string}`[];
          data: `0x${string}`;
          event_name: string;
          event_args: unknown;
        }>(
          `SELECT l.transaction_hash,l.transaction_index,l.log_index,l.block_hash,l.block_number,
                  l.address,l.topics,l.data,l.event_name,l.event_args
           FROM raw_logs l JOIN m7_projection_events p
             ON p.chain_id=l.chain_id AND p.transaction_hash=l.transaction_hash
            AND p.log_index=l.log_index AND p.block_hash=l.block_hash
           WHERE l.chain_id=$1 AND l.block_hash=ANY($2::text[]) AND p.canonical=true
           ORDER BY l.block_number DESC,l.transaction_index DESC,l.log_index DESC`,
          [chainId, orphanedHashes],
        );
        for (const row of projectionLogs.rows)
          await this.reverseProjectionLog(client, {
            chainId,
            transactionHash: row.transaction_hash,
            transactionIndex: row.transaction_index,
            logIndex: row.log_index,
            blockHash: row.block_hash,
            blockNumber: BigInt(row.block_number),
            address: row.address,
            topics: row.topics,
            data: row.data,
            eventName: row.event_name,
            eventArgs: row.event_args,
            finality: 'OBSERVED',
          });
      }
      await client.query(
        `UPDATE raw_logs SET canonical=false,finality='OBSERVED' WHERE chain_id=$1 AND block_hash=ANY($2::text[])`,
        [chainId, orphanedHashes],
      );
      await client.query(
        `UPDATE v2_activities SET canonical=false,finality='OBSERVED' WHERE chain_id=$1 AND block_hash=ANY($2::text[])`,
        [chainId, orphanedHashes],
      );
      await client.query(
        `UPDATE v2_rebalances SET canonical=false,finality='OBSERVED' WHERE chain_id=$1 AND block_hash=ANY($2::text[])`,
        [chainId, orphanedHashes],
      );
      await client.query(
        `UPDATE v2_fee_collections SET canonical=false,finality='OBSERVED' WHERE chain_id=$1 AND block_hash=ANY($2::text[])`,
        [chainId, orphanedHashes],
      );
      await client.query(
        `UPDATE vaults SET indexed_through_block=$2,indexed_block_hash=$3,updated_at=now()
         WHERE chain_id=$1 AND factory_address IS NOT NULL`,
        [chainId, ancestor.number.toString(), ancestor.hash],
      );
      await client.query(
        `UPDATE balances SET as_of_block=$2,indexed_block_hash=$3,finality='OBSERVED',updated_at=now()
         WHERE chain_id=$1`,
        [chainId, ancestor.number.toString(), ancestor.hash],
      );
      await client.query(
        `INSERT INTO m7_projection_state(chain_id,generation,indexed_through_block,indexed_block_hash,finality)
         VALUES($1,1,$2,$3,$4)
         ON CONFLICT(chain_id) DO UPDATE SET generation=m7_projection_state.generation+1,
         indexed_through_block=EXCLUDED.indexed_through_block,indexed_block_hash=EXCLUDED.indexed_block_hash,
         finality=EXCLUDED.finality,updated_at=now()`,
        [chainId, ancestor.number.toString(), ancestor.hash, ancestor.finality],
      );
      await client.query(
        `UPDATE cursors SET block_number=$3,block_hash=$4,updated_at=now() WHERE chain_id=$1 AND consumer=$2`,
        [chainId, consumer, ancestor.number.toString(), ancestor.hash],
      );
      await client.query(
        `INSERT INTO reorg_journal(chain_id,consumer,ancestor_block,ancestor_hash,depth,orphaned_hashes,status) VALUES($1,$2,$3,$4,$5,$6::jsonb,'RECOVERED')`,
        [
          chainId,
          consumer,
          ancestor.number.toString(),
          ancestor.hash,
          depth,
          JSON.stringify(orphaned.rows.map((r) => r.block_hash)),
        ],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  async promoteFinality(
    chainId: ChainId,
    consumer: string,
    fenceToken: bigint,
    confirmed?: bigint,
    finalized?: bigint,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertFence(client, chainId, consumer, fenceToken);
      await client.query(
        `UPDATE headers SET finality=CASE WHEN $3::numeric IS NOT NULL AND block_number<=$3 THEN 'FINALIZED' WHEN $2::numeric IS NOT NULL AND block_number<=$2 THEN 'CONFIRMED' ELSE finality END WHERE chain_id=$1 AND canonical=true`,
        [chainId, confirmed?.toString() ?? null, finalized?.toString() ?? null],
      );
      await client.query(
        `UPDATE raw_logs l SET finality=h.finality FROM headers h WHERE l.chain_id=$1 AND h.chain_id=l.chain_id AND h.block_hash=l.block_hash AND l.canonical=true`,
        [chainId],
      );
      for (const table of ['v2_activities', 'v2_rebalances', 'v2_fee_collections']) {
        await client.query(
          `UPDATE ${table} x SET finality=h.finality FROM headers h WHERE x.chain_id=$1 AND h.chain_id=x.chain_id AND h.block_hash=x.block_hash AND x.canonical=true`,
          [chainId],
        );
      }
      const vaultFinality = await client.query(
        `UPDATE vaults v SET finality=h.finality,updated_at=now() FROM headers h
         WHERE v.chain_id=$1 AND v.factory_address IS NOT NULL AND h.chain_id=v.chain_id
           AND h.block_number=v.creation_block AND h.canonical=true AND v.finality IS DISTINCT FROM h.finality`,
        [chainId],
      );
      const balanceFinality = await client.query(
        `UPDATE balances b SET finality=h.finality,updated_at=now() FROM headers h
         WHERE b.chain_id=$1 AND h.chain_id=b.chain_id AND h.block_number=b.as_of_block
           AND h.canonical=true AND b.finality IS DISTINCT FROM h.finality`,
        [chainId],
      );
      const stateFinality = await client.query(
        `UPDATE m7_projection_state s SET finality=h.finality,updated_at=now() FROM headers h
         WHERE s.chain_id=$1 AND h.chain_id=s.chain_id AND h.block_number=s.indexed_through_block
           AND h.canonical=true AND s.finality IS DISTINCT FROM h.finality`,
        [chainId],
      );
      if ((vaultFinality.rowCount ?? 0) + (balanceFinality.rowCount ?? 0) + (stateFinality.rowCount ?? 0) > 0)
        await client.query('UPDATE m7_projection_state SET generation=generation+1 WHERE chain_id=$1', [
          chainId,
        ]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  async reconcile(
    chainId: ChainId,
    consumer: string,
  ): Promise<{
    ok: boolean;
    cursor: bigint | null;
    fromBlock: bigint | null;
    toBlock: bigint | null;
    cursorMatchesHead: boolean;
    gaps: number;
    duplicates: number;
  }> {
    const r = await this.pool.query(
      `WITH ordered AS (SELECT block_number,lag(block_number) OVER(ORDER BY block_number) p FROM headers WHERE chain_id=$1 AND canonical=true), stats AS (SELECT min(block_number) first_block,max(block_number) last_block,count(*) FILTER(WHERE p IS NOT NULL AND block_number<>p+1) gaps FROM ordered), dups AS (SELECT count(*)-count(DISTINCT (transaction_hash,log_index,block_hash)) n FROM raw_logs WHERE chain_id=$1 AND canonical=true) SELECT (SELECT block_number FROM cursors WHERE chain_id=$1 AND consumer=$2) cursor,(SELECT first_block FROM stats) first_block,(SELECT last_block FROM stats) last_block,(SELECT gaps FROM stats) gaps,(SELECT n FROM dups) duplicates`,
      [chainId, consumer],
    );
    const row = r.rows[0] as {
      cursor: string | null;
      first_block: string | null;
      last_block: string | null;
      gaps: string;
      duplicates: string;
    };
    const result = {
      cursor: row.cursor === null ? null : BigInt(row.cursor),
      fromBlock: row.first_block === null ? null : BigInt(row.first_block),
      toBlock: row.last_block === null ? null : BigInt(row.last_block),
      gaps: Number(row.gaps),
      duplicates: Number(row.duplicates),
    };
    const cursorMatchesHead = result.cursor !== null && result.cursor === result.toBlock;
    const ok = result.fromBlock !== null && cursorMatchesHead && result.gaps === 0 && result.duplicates === 0;
    await this.pool.query(
      `INSERT INTO reconciliation_results(chain_id,consumer,from_block,to_block,manifest_version,passed,detail) VALUES($1,$2,$3,$4,'runtime',$5,$6::jsonb)`,
      [
        chainId,
        consumer,
        result.fromBlock?.toString() ?? '0',
        result.toBlock?.toString() ?? '0',
        ok,
        JSON.stringify({
          gaps: result.gaps,
          duplicates: result.duplicates,
          cursorMatchesHead,
          fromBlock: result.fromBlock?.toString() ?? null,
          toBlock: result.toBlock?.toString() ?? null,
        }),
      ],
    );
    return { ...result, cursorMatchesHead, ok };
  }
}
