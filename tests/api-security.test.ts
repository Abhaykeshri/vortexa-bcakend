import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../apps/api/src/config/env.js';
import {
  enforceSecurity,
  csrfAllowsRequest,
  httpSecurityHeaders,
  rateLimitClientId,
  responseWithRequestId,
  serializeJsonResponse,
  validateContentLength,
  type RateLimiter,
} from '../apps/api/src/security.js';
import type { DeploymentManifest } from '../packages/contracts/src/manifest.js';

const address = `0x${'1'.repeat(40)}` as const;
const contractKeys = [
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
] as const;
const contractEnvironment = Object.fromEntries(contractKeys.map((key) => [`CONTRACT_${key}`, address]));
const manifest = {
  schemaVersion: 1,
  manifestVersion: 'security-test-v1',
  chainId: 11155111,
  network: 'sepolia',
  contracts: Object.fromEntries(contractKeys.map((name) => [name, { name }])),
} as unknown as DeploymentManifest;

const secret = 'test-internal-key-with-at-least-32-characters';
const config = loadConfig(
  {
    NODE_ENV: 'test',
    ...contractEnvironment,
    SEPOLIA_RPC_URL: 'https://rpc.example.org',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173,https://dev.example.org',
    INTERNAL_API_KEY: secret,
    GLOBAL_RATE_LIMIT: '60',
  },
  manifest,
);

test('HTTP security headers preserve the API CSP and add Helmet-compatible protections', () => {
  const headers = httpSecurityHeaders(false);
  assert.equal(headers['Content-Security-Policy'], "default-src 'none'; frame-ancestors 'none'");
  assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(headers['Cross-Origin-Resource-Policy'], 'same-origin');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['X-XSS-Protection'], '0');
  assert.equal(headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(headers['Strict-Transport-Security'], undefined);
  assert.equal(httpSecurityHeaders(true)['Strict-Transport-Security'], 'max-age=31536000');
});

test('JSON responses preserve valid markup-like data without creating an HTML response', () => {
  const payload = {
    label: '<script>alert("x")</script>',
    detail: 'A & B',
  };
  const body = serializeJsonResponse(payload);
  assert.deepEqual(JSON.parse(body), payload);
  assert.doesNotMatch(body, /<script>/);
  assert.equal(httpSecurityHeaders(false)['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(httpSecurityHeaders(false)['X-Content-Type-Options'], 'nosniff');
});

test('responses carry a server-generated request ID without trusting arbitrary values', () => {
  const requestId = '123e4567-e89b-42d3-a456-426614174000';
  assert.deepEqual(responseWithRequestId({ status: 'ok' }, requestId), { status: 'ok', requestId });
  assert.deepEqual(responseWithRequestId('ok', requestId), { data: 'ok', requestId });
  assert.throws(() => responseWithRequestId({}, '<script>not-an-id</script>'), /Invalid request ID/);
});

test('payload limit and CSRF helpers fail closed only where the threat model applies', () => {
  assert.equal(validateContentLength('1024', 1024), 1024);
  assert.throws(() => validateContentLength('1025', 1024), /PAYLOAD_TOO_LARGE/);
  assert.throws(() => validateContentLength('invalid', 1024), /INVALID_CONTENT_LENGTH/);
  assert.equal(
    csrfAllowsRequest({
      method: 'POST',
      cookieAuthenticated: true,
      origin: 'https://evil.example',
      allowedOrigins: ['https://app.example'],
    }),
    false,
  );
  assert.equal(csrfAllowsRequest({ method: 'GET', cookieAuthenticated: true, allowedOrigins: [] }), true);
  assert.equal(csrfAllowsRequest({ method: 'POST', cookieAuthenticated: false, allowedOrigins: [] }), true);
});

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
  assert.equal(withOrigin.headers['Access-Control-Allow-Credentials'], undefined);
  const secondOrigin = await enforceSecurity(
    {
      method: 'GET',
      path: '/api/v1/network',
      origin: 'https://dev.example.org',
      clientId: '127.0.0.3',
    },
    config,
    new FakeLimiter(),
  );
  assert.equal(secondOrigin.headers['Access-Control-Allow-Origin'], 'https://dev.example.org');
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
  const nullOrigin = await enforceSecurity(
    { method: 'GET', path: '/api/v1/network', origin: 'null', clientId: '127.0.0.1' },
    config,
    new FakeLimiter(),
  );
  assert.equal(nullOrigin.status, 403);

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
  for (let i = 0; i < config.contractStatusRateLimit; i++)
    assert.equal((await enforceSecurity(request, config, limiter)).handled, false);
  const blocked = await enforceSecurity(request, config, limiter);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers['Retry-After'], '60');
});

test('concurrent rate-limit requests cannot exceed the configured threshold', async () => {
  const limiter = new FakeLimiter();
  const request = { method: 'GET', path: '/api/v1/contracts/status', clientId: '203.0.113.11' };
  const results = await Promise.all(
    Array.from({ length: config.contractStatusRateLimit + 5 }, () =>
      enforceSecurity(request, config, limiter),
    ),
  );
  assert.equal(results.filter((result) => result.handled === false).length, config.contractStatusRateLimit);
  assert.equal(results.filter((result) => result.status === 429).length, 5);
});

test('M7 dynamic routes are exact-origin protected and Redis rate limited before handlers', async () => {
  const allowed = await enforceSecurity(
    {
      method: 'GET',
      path: `/api/v1/vaults/${address}/events`,
      origin: 'http://localhost:5173',
      clientId: '203.0.113.20',
    },
    config,
    new FakeLimiter(),
  );
  assert.equal(allowed.handled, false);
  assert.equal(allowed.headers['RateLimit-Limit'], String(config.m7EventRateLimit));
  const blockedOrigin = await enforceSecurity(
    {
      method: 'GET',
      path: `/api/v1/wallets/${address}/positions`,
      origin: 'https://evil.example',
      clientId: '203.0.113.20',
    },
    config,
    new FakeLimiter(),
  );
  assert.equal(blockedOrigin.status, 403);
  const noRedis = await enforceSecurity(
    { method: 'GET', path: '/api/v1/vaults/not-an-address', clientId: '203.0.113.20' },
    config,
  );
  assert.equal(noRedis.status, 503);
});

test('rate-limited routes fail closed when Redis is missing or fails', async () => {
  const request = { method: 'GET', path: '/api/v1/network', clientId: '127.0.0.1' };
  assert.equal((await enforceSecurity(request, config)).status, 503);
  const limiter = new FakeLimiter();
  limiter.fail = true;
  assert.equal((await enforceSecurity(request, config, limiter)).status, 503);
});

test('proxy rate-limit identity uses only the validated rightmost forwarded peer', () => {
  assert.equal(rateLimitClientId('10.0.0.2', '198.51.100.10, 203.0.113.7', true), '203.0.113.7');
  assert.equal(rateLimitClientId('10.0.0.2', '198.51.100.10, not-an-ip', true), '10.0.0.2');
  assert.equal(rateLimitClientId('10.0.0.2', '198.51.100.10', false), '10.0.0.2');
});

test('production rejects missing security config and non-HTTPS origins', () => {
  const base = {
    NODE_ENV: 'production',
    ...contractEnvironment,
    SEPOLIA_RPC_URL: 'https://rpc.example.org',
    DATABASE_URL: 'postgresql://database.example.org/vortexa',
    REDIS_URL: 'rediss://redis.example.org:6380',
    INTERNAL_API_KEY: secret,
  };
  assert.throws(() => loadConfig(base, manifest), /CORS_ALLOWED_ORIGINS/);
  assert.throws(
    () => loadConfig({ ...base, CORS_ALLOWED_ORIGINS: 'http://app.example.org' }, manifest),
    /HTTPS/,
  );
});
