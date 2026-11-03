import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../apps/api/src/config/env.js';
import { enforceSecurity, type RateLimiter } from '../apps/api/src/security.js';
import type { DeploymentManifest } from '../packages/contracts/src/manifest.js';

const address = `0x${'1'.repeat(40)}` as const;
const manifest = {
  schemaVersion: 1,
  manifestVersion: 'security-test-v1',
  chainId: 11155111,
  network: 'sepolia',
  contracts: Object.fromEntries(
    [
      'PRICE_GUARD',
      'SHAPE_LIBRARY',
      'TIMELOCK_CONTROLLER',
      'VAULT',
      'VAULT_FACTORY',
      'VAULT_LENS',
      'FEE_COLLECTOR',
      'NORMAL_LP_STRATEGY',
      'BUY_THE_DIP_STRATEGY',
      'SELL_THE_PUMP_STRATEGY',
      'SWAP_EXECUTOR',
      'ZAP',
    ].map((name) => [name, { name, address }]),
  ),
} as unknown as DeploymentManifest;

const secret = 'test-internal-key-with-at-least-32-characters';
const config = loadConfig(
  {
    NODE_ENV: 'test',
    SEPOLIA_RPC_URL: 'https://rpc.example.org',
    CORS_ALLOWED_ORIGINS_DEVELOPMENT: 'http://localhost:5173,https://dev.example.org',
    INTERNAL_API_KEY: secret,
    NETWORK_RATE_LIMIT: '2',
    CHAIN_RATE_LIMIT: '2',
    CONTRACT_STATUS_RATE_LIMIT: '1',
  },
  manifest,
);

class FakeLimiter implements RateLimiter {
  count = 0;
  fail = false;
  async rateLimit(_scope: string, limit: number) {
    if (this.fail) throw new Error('redis down');
    this.count += 1;
    return { allowed: this.count <= limit, remaining: Math.max(0, limit - this.count) };
  }
}

test('internal endpoints accept only a valid bearer API key without a browser Origin', async () => {
  const valid = await enforceSecurity(
    {
      method: 'GET',
      path: '/health/ready',
      authorization: `Bearer ${secret}`,
      clientId: '127.0.0.1',
    },
    config,
  );
  assert.equal(valid.handled, false);

  const invalid = await enforceSecurity(
    {
      method: 'GET',
      path: '/health/ready',
      authorization: 'Bearer wrong-key',
      clientId: '127.0.0.1',
    },
    config,
  );
  assert.equal(invalid.status, 401);

  const missing = await enforceSecurity(
    { method: 'GET', path: '/api/v1/contracts/wiring', clientId: '127.0.0.1' },
    config,
  );
  assert.equal(missing.status, 401);
});

test('internal routes reject browser origins even when the API key is valid', async () => {
  const result = await enforceSecurity(
    {
      method: 'GET',
      path: '/api/v1/contracts/wiring',
      origin: 'http://localhost:5173',
      authorization: `Bearer ${secret}`,
      clientId: '127.0.0.1',
    },
    config,
  );
  assert.equal(result.status, 403);
});

test('browser routes allow missing Origin for server clients and exact configured origins', async () => {
  const limiter = new FakeLimiter();
  const withoutOrigin = await enforceSecurity(
    { method: 'GET', path: '/api/v1/network', clientId: '127.0.0.1' },
    config,
    limiter,
  );
  assert.equal(withoutOrigin.handled, false);
  assert.equal(withoutOrigin.headers['Access-Control-Allow-Origin'], undefined);

  const withOrigin = await enforceSecurity(
    {
      method: 'GET',
      path: '/api/v1/network',
      origin: 'http://localhost:5173',
      clientId: '127.0.0.2',
    },
    config,
    new FakeLimiter(),
  );
  assert.equal(withOrigin.headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
});

test('disallowed origins and protected-route preflights are rejected', async () => {
  const disallowed = await enforceSecurity(
    {
      method: 'GET',
      path: '/api/v1/network',
      origin: 'https://evil.example',
      clientId: '127.0.0.1',
    },
    config,
    new FakeLimiter(),
  );
  assert.equal(disallowed.status, 403);

  const protectedPreflight = await enforceSecurity(
    {
      method: 'OPTIONS',
      path: '/health/ready',
      origin: 'http://localhost:5173',
      requestedMethod: 'GET',
      clientId: '127.0.0.1',
    },
    config,
  );
  assert.equal(protectedPreflight.status, 403);
});

test('valid browser preflight returns only the approved GET policy', async () => {
  const result = await enforceSecurity(
    {
      method: 'OPTIONS',
      path: '/api/v1/chain/status',
      origin: 'http://localhost:5173',
      requestedMethod: 'GET',
      requestedHeaders: 'Accept, Content-Type',
      clientId: '127.0.0.1',
    },
    config,
  );
  assert.equal(result.status, 204);
  assert.equal(result.headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
  assert.equal(result.headers['Access-Control-Allow-Methods'], 'GET');
});

test('strict contract-status limit is enforced', async () => {
  const limiter = new FakeLimiter();
  const request = {
    method: 'GET',
    path: '/api/v1/contracts/status',
    clientId: '203.0.113.10',
  };
  assert.equal((await enforceSecurity(request, config, limiter)).handled, false);
  const blocked = await enforceSecurity(request, config, limiter);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers['Retry-After'], '60');
});

test('rate-limited routes fail closed when Redis is missing or fails', async () => {
  const request = { method: 'GET', path: '/api/v1/network', clientId: '127.0.0.1' };
  assert.equal((await enforceSecurity(request, config)).status, 503);
  const limiter = new FakeLimiter();
  limiter.fail = true;
  assert.equal((await enforceSecurity(request, config, limiter)).status, 503);
});

test('production rejects missing security config and non-HTTPS origins', () => {
  const base = {
    NODE_ENV: 'production',
    SEPOLIA_RPC_URL: 'https://rpc.example.org',
    REDIS_URL: 'rediss://redis.example.org:6380',
    INTERNAL_API_KEY: secret,
  };
  assert.throws(() => loadConfig(base, manifest), /CORS_ALLOWED_ORIGINS_PRODUCTION/);
  assert.throws(
    () => loadConfig({ ...base, CORS_ALLOWED_ORIGINS_PRODUCTION: 'http://app.example.org' }, manifest),
    /HTTPS/,
  );
});
