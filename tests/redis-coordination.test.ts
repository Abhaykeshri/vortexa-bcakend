import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RedisCoordinationAdapter,
  RedisUnavailableError,
} from '../packages/adapters/src/redis-coordination.js';

class FakeRedis {
  data = new Map<string, string>();
  fail = false;
  published: string[] = [];
  async get(k: string) {
    if (this.fail) throw new Error();
    return this.data.get(k) ?? null;
  }
  async set(k: string, v: string, o?: { NX?: boolean }) {
    if (this.fail) throw new Error();
    if (o?.NX && this.data.has(k)) return null;
    this.data.set(k, v);
    return 'OK';
  }
  async del(k: string) {
    if (this.fail) throw new Error();
    return this.data.delete(k) ? 1 : 0;
  }
  async eval(s: string, o: { keys: string[]; arguments: string[] }) {
    if (this.fail) throw new Error();
    if (s.includes("redis.call('INCR'")) {
      const n = Number(this.data.get(o.keys[0]!) ?? 0) + 1;
      this.data.set(o.keys[0]!, String(n));
      return n;
    }
    if (this.data.get(o.keys[0]!) !== o.arguments[0]) return 0;
    if (o.arguments.length === 1) return this.data.delete(o.keys[0]!) ? 1 : 0;
    return 1;
  }
  async publish(_c: string, m: string) {
    if (this.fail) throw new Error();
    this.published.push(m);
    return 1;
  }
}
test('cache uses namespaced JSON and degrades to miss on outage', async () => {
  const f = new FakeRedis();
  const a = new RedisCoordinationAdapter(f);
  await a.set('vault_1', { x: 1 }, 10);
  assert.deepEqual(await a.get('vault_1'), { x: 1 });
  f.fail = true;
  assert.equal(await a.get('vault_1'), null);
});
test('leases are owner safe and fail closed', async () => {
  const f = new FakeRedis();
  const a = new RedisCoordinationAdapter(f);
  assert.equal(await a.acquire('job_1', 'worker_1', 1000), true);
  assert.equal(await a.release('job_1', 'worker_2'), false);
  assert.equal(await a.release('job_1', 'worker_1'), true);
  f.fail = true;
  assert.equal(await a.acquire('job_2', 'worker_1', 1000), false);
});
test('rate limit fails closed when Redis is unavailable', async () => {
  const f = new FakeRedis();
  const a = new RedisCoordinationAdapter(f);
  assert.deepEqual(await a.rateLimit('wallet_1', 1, 60), { allowed: true, remaining: 0 });
  assert.equal((await a.rateLimit('wallet_1', 1, 60)).allowed, false);
  f.fail = true;
  await assert.rejects(() => a.rateLimit('wallet_2', 1, 60), RedisUnavailableError);
});
