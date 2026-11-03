import test from 'node:test';
import assert from 'node:assert/strict';
import { OutboxWorker, type DurableOutboxPort } from '../packages/application/src/outbox-worker.js';

test('outbox worker completes delivered messages', async () => {
  const completed: string[] = [];
  let claimed = false;
  let claimOwner = '';
  const outbox: DurableOutboxPort = {
    claimOutbox: async (owner, limit) => {
      assert.equal(limit, 1);
      claimOwner = owner;
      if (claimed) return [];
      claimed = true;
      return [{ id: '1', topic: 'vault.updated', payload: { vault: 'x' }, attempts: 0 }];
    },
    completeOutbox: async (id, owner) => {
      assert.equal(owner, claimOwner);
      completed.push(id);
    },
    failOutbox: async () => assert.fail('must not fail'),
  };
  const result = await new OutboxWorker(outbox, { publish: async () => {} }).runOnce('worker-1');
  assert.deepEqual(result, { processed: 1, failed: 0 });
  assert.deepEqual(completed, ['1']);
});

test('outbox worker applies bounded retry/dead-letter policy', async () => {
  const failures: Array<{ id: string; max: number; delay: number }> = [];
  let claimed = false;
  const outbox: DurableOutboxPort = {
    claimOutbox: async () => {
      if (claimed) return [];
      claimed = true;
      return [{ id: '2', topic: 'vault.updated', payload: {}, attempts: 7 }];
    },
    completeOutbox: async () => assert.fail('must not complete'),
    failOutbox: async (id, _owner, _error, max, delay) => void failures.push({ id, max, delay }),
  };
  const result = await new OutboxWorker(outbox, {
    publish: async () => Promise.reject(new Error('down')),
  }).runOnce('worker-1');
  assert.deepEqual(result, { processed: 0, failed: 1 });
  assert.deepEqual(failures, [{ id: '2', max: 8, delay: 256 }]);
});

test('outbox claims use a fresh per-run fencing owner', async () => {
  const owners: string[] = [];
  const outbox: DurableOutboxPort = {
    claimOutbox: async (owner) => {
      owners.push(owner);
      return [];
    },
    completeOutbox: async () => assert.fail('no messages to complete'),
    failOutbox: async () => assert.fail('no messages to fail'),
  };
  const worker = new OutboxWorker(outbox, { publish: async () => {} });
  await worker.runOnce('worker-1');
  await worker.runOnce('worker-1');
  assert.notEqual(owners[0], owners[1]);
  assert.match(owners[0]!, /^worker-1-[0-9a-f-]{36}$/);
});
