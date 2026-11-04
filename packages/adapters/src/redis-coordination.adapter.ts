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
/**
 * Provides namespaced cache, lease, distributed rate-limit, and notification
 * primitives. Optional cache operations degrade safely; authorization-related
 * rate limiting fails closed when Redis is unavailable.
 */
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
  private cacheKey(value: string): string {
    if (/^[a-zA-Z0-9._-]{1,160}$/.test(value)) return `${this.namespace}:cache:${value}`;
    const parts = value.split(':');
    if (
      parts.length !== 4 ||
      !/^[a-z0-9._-]{1,512}$/.test(parts[0]!) ||
      !/^v[0-9]+\.g[0-9]+$/.test(parts[1]!) ||
      !/^(?:start|[A-Za-z0-9_-]{1,2048})$/.test(parts[2]!) ||
      !/^(?:[1-9]|[1-9][0-9]|100)$/.test(parts[3]!)
    )
      throw new Error('Invalid response cache key');
    return `${this.namespace}:cache:${value}`;
  }
  async get<T>(key: string): Promise<T | null> {
    const redisKey = this.cacheKey(key);
    try {
      const value = await this.redis.get(redisKey);
      return value === null ? null : (JSON.parse(value) as T);
    } catch {
      return null;
    }
  }
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86400)
      throw new Error('Invalid cache TTL');
    const redisKey = this.cacheKey(key);
    try {
      await this.redis.set(redisKey, JSON.stringify(value), { EX: ttlSeconds });
    } catch {
      /* cache is optional */
    }
  }
  async delete(key: string): Promise<void> {
    const redisKey = this.cacheKey(key);
    try {
      await this.redis.del(redisKey);
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
      throw new RedisUnavailableError();
    }
  }
  static leaseOwner(prefix = 'worker'): string {
    return `${safeSegment(prefix)}-${randomUUID()}`;
  }
}

/**
 * Creates and connects the production Redis client with bounded reconnect
 * backoff and a caller-supplied sanitized background error observer.
 */
export async function connectRedis(url: string, onError: (error: unknown) => void = () => undefined) {
  const client = createClient({
    url,
    socket: { connectTimeout: 5000, reconnectStrategy: (retries) => Math.min(100 * 2 ** retries, 5000) },
  });
  client.on('error', onError);
  await client.connect();
  return client;
}
