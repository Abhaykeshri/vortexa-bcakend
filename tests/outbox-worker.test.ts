import test from 'node:test';
import assert from 'node:assert/strict';
import { OutboxWorker, type DurableOutboxPort } from '../packages/application/src/outbox-worker.js';

test('outbox worker completes delivered messages', async () => {
  const completed: string[] = [];
  const outbox: DurableOutboxPort = {
    claimOutbox: async () => [{ id: '1', topic: 'vault.updated', payload: { vault: 'x' }, attempts: 0 }],
    completeOutbox: async (id) => void completed.push(id),
    failOutbox: async () => assert.fail('must not fail'),
  };
  const result = await new OutboxWorker(outbox, { publish: async () => {} }).runOnce('worker-1');
  assert.deepEqual(result, { processed: 1, failed: 0 });
  assert.deepEqual(completed, ['1']);
});

test('outbox worker applies bounded retry/dead-letter policy', async () => {
  const failures: Array<{ id: string; max: number; delay: number }> = [];
  const outbox: DurableOutboxPort = {
    claimOutbox: async () => [{ id: '2', topic: 'vault.updated', payload: {}, attempts: 7 }],
    completeOutbox: async () => assert.fail('must not complete'),
    failOutbox: async (id, _error, max, delay) => void failures.push({ id, max, delay }),
  };
  const result = await new OutboxWorker(outbox, {
    publish: async () => Promise.reject(new Error('down')),
  }).runOnce('worker-1');
  assert.deepEqual(result, { processed: 0, failed: 1 });
  assert.deepEqual(failures, [{ id: '2', max: 8, delay: 256 }]);
});
