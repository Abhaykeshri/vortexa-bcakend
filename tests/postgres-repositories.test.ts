import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { PostgresIndexerStore } from '../packages/adapters/src/postgres/indexer-store.js';
import {
  DurableWorkRepository,
  PostgresVaultRepository,
} from '../packages/adapters/src/postgres/repositories.js';
const addr = `0x${'1'.repeat(40)}` as const;
test('Postgres repository parameterizes writes and preserves bigint', async () => {
  const calls: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  const db = {
    query: async (text: string, values?: readonly unknown[]) => {
      calls.push({ text, values });
      return { rows: [], rowCount: 1 };
    },
  };
  await new PostgresVaultRepository(db).save({
    chainId: 11155111,
    address: addr,
    strategy: 'NormalLP',
    shapeId: 3,
    ownerRole: 'GOVERNANCE_ONLY',
    asOfBlock: 2n ** 100n,
  });
  assert.match(calls[0]!.text, /\$1/);
  assert.equal(calls[0]!.values?.[5], (2n ** 100n).toString());
  assert.equal(calls[0]!.text.includes(addr), false);
});
test('Postgres repository maps numeric quantities back to bigint', async () => {
  const db = {
    query: async () => ({
      rows: [
        {
          chain_id: '11155111',
          address: addr.toLowerCase(),
          strategy: 'NormalLP',
          shape_id: 3,
          owner_role: 'GOVERNANCE_ONLY',
          as_of_block: '123456789012345678901',
        },
      ],
      rowCount: 1,
    }),
  };
  const result = await new PostgresVaultRepository(db).find(11155111, addr);
  assert.equal(result?.asOfBlock, 123456789012345678901n);
});

test('Postgres indexer fencing rejects a stale process before any batch write', async () => {
  let fenceToken = 0n;
  let batchWrites = 0;
  const client = {
    query: async (text: string) => {
      if (text.startsWith('SELECT fence_token'))
        return { rows: [{ fence_token: fenceToken.toString() }], rowCount: 1 };
      if (text.startsWith('INSERT INTO headers')) batchWrites++;
      return { rows: [], rowCount: 1 };
    },
    release: () => {},
  };
  const pool = {
    query: async () => {
      fenceToken++;
      return { rows: [{ fence_token: fenceToken.toString() }], rowCount: 1 };
    },
    connect: async () => client,
  } as unknown as Pool;
  const store = new PostgresIndexerStore(pool);
  const oldToken = await store.acquireFence(11155111, 'm6-indexer');
  const currentToken = await store.acquireFence(11155111, 'm6-indexer');
  const header = {
    chainId: 11155111 as const,
    number: 1n,
    hash: `0x${'1'.repeat(64)}` as const,
    parentHash: `0x${'0'.repeat(64)}` as const,
    timestamp: 1n,
    finality: 'OBSERVED' as const,
  };
  await assert.rejects(() => store.commitBatch('m6-indexer', oldToken, [header], []), /INDEXER_FENCE_LOST/);
  assert.equal(batchWrites, 0);
  await store.commitBatch('m6-indexer', currentToken, [header], []);
  assert.equal(batchWrites, 1);
});
test('Postgres indexer shutdown status is fenced to its current worker', async () => {
  let stateFence = 7n;
  let state = 'RUNNING';
  let lastError: string | null = null;
  const pool = {
    query: async (text: string, values: readonly unknown[] = []) => {
      if (!text.startsWith('UPDATE indexer_worker_state')) throw new Error(`Unexpected query: ${text}`);
      if (BigInt(String(values[2])) !== stateFence) return { rows: [], rowCount: 0 };
      state = String(values[3]);
      lastError = typeof values[4] === 'string' ? values[4] : null;
      return { rows: [], rowCount: 1 };
    },
  } as unknown as Pool;
  const store = new PostgresIndexerStore(pool);
  await store.finishWorker(11155111, 'm6-indexer', 7n, 'STOPPED', null);
  assert.equal(state, 'STOPPED');
  assert.equal(lastError, null);
  await assert.rejects(store.finishWorker(11155111, 'm6-indexer', 6n, 'STOPPED', null), /INDEXER_FENCE_LOST/);
  stateFence = 8n;
  await assert.rejects(
    store.finishWorker(11155111, 'm6-indexer', 7n, 'DEGRADED', 'IndexerRpcOperationError'),
    /INDEXER_FENCE_LOST/,
  );
  assert.equal(state, 'STOPPED');
  await store.finishWorker(11155111, 'm6-indexer', 8n, 'DEGRADED', 'IndexerRpcOperationError');
  assert.equal(state, 'DEGRADED');
  assert.equal(lastError, 'IndexerRpcOperationError');
});

test('outbox claims are exclusive and stale owners cannot complete', async () => {
  const row = {
    id: '00000000-0000-0000-0000-000000000001',
    topic: 'vault.updated',
    payload: {},
    attempts: 0,
    owner: null as string | null,
    claimUntil: 0,
    processed: false,
  };
  let claimSql = '';
  const pool = {
    query: async (text: string, values: readonly unknown[] = []) => {
      if (text.startsWith('WITH candidates')) {
        claimSql = text;
        if (row.processed || (row.owner && row.claimUntil > Date.now())) return { rows: [], rowCount: 0 };
        row.attempts++;
        row.owner = String(values[1]);
        row.claimUntil = Date.now() + 300_000;
        return {
          rows: [{ id: row.id, topic: row.topic, payload: row.payload, attempts: row.attempts - 1 }],
          rowCount: 1,
        };
      }
      if (text.startsWith('UPDATE outbox SET processed_at')) {
        if (row.owner !== values[1] || row.claimUntil <= Date.now() || row.processed)
          return { rows: [], rowCount: 0 };
        row.processed = true;
        row.owner = null;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  } as unknown as Pool;
  const repository = new DurableWorkRepository(pool);
  const [first, second] = await Promise.all([
    repository.claimOutbox('worker-a', 1),
    repository.claimOutbox('worker-b', 1),
  ]);
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
  assert.match(claimSql, /claim_until IS NULL OR claim_until <= now\(\)/);
  assert.match(claimSql, /FOR UPDATE SKIP LOCKED/);
  row.claimUntil = Date.now() - 1;
  assert.equal((await repository.claimOutbox('worker-b', 1)).length, 1);
  await assert.rejects(() => repository.completeOutbox(row.id, 'worker-a'), /claim lost/);
  await repository.completeOutbox(row.id, 'worker-b');
  assert.equal((await repository.claimOutbox('worker-c', 1)).length, 0);
});
