import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import type { CachePort, LeasePort } from '../../domain/src/ports.js';

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { EX?: number; PX?: number; NX?: boolean },
  ): Promise<string | null>;
  del(key: string): Promise<number>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  publish(channel: string, message: string): Promise<number>;
}

export class RedisUnavailableError extends Error {
  constructor() {
    super('Redis coordination unavailable');
    this.name = 'RedisUnavailableError';
  }
}
function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9._-]{1,160}$/.test(value)) throw new Error('Invalid Redis key segment');
  return value;
}
export class RedisCoordinationAdapter implements CachePort, LeasePort {
  constructor(
    private readonly redis: RedisLike,
    private readonly namespace = 'vortexa:v1',
  ) {
    safeSegment(namespace.replace(/:/g, '_'));
  }
  private key(kind: string, value: string): string {
    return `${this.namespace}:${safeSegment(kind)}:${safeSegment(value)}`;
  }
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(this.key('cache', key));
      return value === null ? null : (JSON.parse(value) as T);
    } catch {
      return null;
    }
  }
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86400)
      throw new Error('Invalid cache TTL');
    try {
      await this.redis.set(this.key('cache', key), JSON.stringify(value), { EX: ttlSeconds });
    } catch {
      /* cache is optional */
    }
  }
  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(this.key('cache', key));
    } catch {
      /* cache is optional */
    }
  }
  async acquire(key: string, owner: string, ttlMs: number): Promise<boolean> {
    try {
      return (
        (await this.redis.set(this.key('lease', key), safeSegment(owner), { NX: true, PX: ttlMs })) === 'OK'
      );
    } catch {
      return false;
    }
  }
  async renew(key: string, owner: string, ttlMs: number): Promise<boolean> {
    try {
      return (
        Number(
          await this.redis.eval(
            "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end",
            { keys: [this.key('lease', key)], arguments: [safeSegment(owner), String(ttlMs)] },
          ),
        ) === 1
      );
    } catch {
      return false;
    }
  }
  async release(key: string, owner: string): Promise<boolean> {
    try {
      return (
        Number(
          await this.redis.eval(
            "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
            { keys: [this.key('lease', key)], arguments: [safeSegment(owner)] },
          ),
        ) === 1
      );
    } catch {
      return false;
    }
  }
  async rateLimit(
    scope: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number }> {
    try {
      const key = this.key('rate', scope);
      const count = Number(
        await this.redis.eval(
          "local current=redis.call('INCR',KEYS[1]); if current==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return current",
          { keys: [key], arguments: [String(windowSeconds)] },
        ),
      );
      if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid Redis rate result');
      return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
    } catch {
      throw new RedisUnavailableError();
    }
  }
  async publish(topic: string, payload: unknown): Promise<void> {
    try {
      await this.redis.publish(this.key('notify', topic), JSON.stringify(payload));
    } catch {
      /* durable outbox remains authoritative */
    }
  }
  static leaseOwner(prefix = 'worker'): string {
    return `${safeSegment(prefix)}-${randomUUID()}`;
  }
}

export async function connectRedis(url: string) {
  const client = createClient({
    url,
    socket: { connectTimeout: 5000, reconnectStrategy: (retries) => Math.min(100 * 2 ** retries, 5000) },
  });
  client.on('error', () => {});
  await client.connect();
  return client;
}
