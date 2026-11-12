import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../apps/api/src/config/env.js';
import {
  enforceSecurity,
  csrfAllowsRequest,
  rateLimitClientId,
  responseWithRequestId,
  validateContentLength,
  type RateLimiter,
} from '../apps/api/src/http-security.js';
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
  'AUTOMATION_TANK',
  'VAULT_M6_MODULE',
  'VAULT_M5_MODULE',
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

test('legacy projection routes require server bearer auth, reject browsers and remain rate limited', async () => {
  const allowed = await enforceSecurity(
    {
      method: 'GET',
      path: `/api/v1/vaults/${address}/events`,
      authorization: `Bearer ${secret}`,
      clientId: '203.0.113.20',
    },
    config,
    new FakeLimiter(),
  );
  assert.equal(allowed.handled, false);
  assert.equal(allowed.headers['RateLimit-Limit'], String(config.vaultEventRateLimit));
  const missingKey = await enforceSecurity(
    { method: 'GET', path: '/api/v1/vaults', clientId: '203.0.113.20' },
    config,
    new FakeLimiter(),
  );
  assert.equal(missingKey.status, 401);
  const blockedOrigin = await enforceSecurity(
    {
      method: 'GET',
      path: `/api/v1/wallets/${address}/positions`,
      origin: 'http://localhost:5173',
      authorization: `Bearer ${secret}`,
      clientId: '203.0.113.20',
    },
    config,
    new FakeLimiter(),
  );
  assert.equal(blockedOrigin.status, 403);
  const noRedis = await enforceSecurity(
    {
      method: 'GET',
      path: '/api/v1/vaults/not-an-address',
      authorization: `Bearer ${secret}`,
      clientId: '203.0.113.20',
    },
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

test('every frontend V2 endpoint requires server bearer auth and Redis rate limiting', async () => {
  const vault = address;
  const frontendRoutes = [
    ['GET', '/v1/openapi.json'],
    ['GET', '/v1/shapes'],
    ['POST', '/v1/shapes/preview'],
    ['GET', '/v1/chains/11155111/vaults'],
    ['GET', `/v1/chains/11155111/vaults/${vault}`],
    ['GET', `/v1/chains/11155111/vaults/${vault}/bands`],
    ['GET', `/v1/chains/11155111/vaults/${vault}/activity`],
    ['GET', `/v1/chains/11155111/vaults/${vault}/history`],
    ['GET', `/v1/chains/11155111/vaults/${vault}/rebalances`],
    ['GET', `/v1/chains/11155111/users/${vault}/positions`],
    ['GET', '/v1/chains/11155111/pools'],
    ['GET', '/v1/chains/11155111/limits'],
    ['POST', '/v1/chains/11155111/tx/validate-config'],
    ['POST', '/v1/chains/11155111/tx/create-vault'],
    ['POST', '/v1/chains/11155111/quotes/deposit'],
    ['POST', '/v1/chains/11155111/tx/deposit'],
    ['POST', '/v1/chains/11155111/quotes/withdraw'],
    ['POST', '/v1/chains/11155111/tx/withdraw'],
    ['POST', '/v1/chains/11155111/tx/manager/update'],
    ['POST', '/v1/chains/11155111/tx/manager/rebalance'],
  ] as const;

  for (const [method, path] of frontendRoutes) {
    const allowed = await enforceSecurity(
      {
        method,
        path,
        authorization: `Bearer ${secret}`,
        clientId: `frontend-${method}-${path}`,
      },
      config,
      new FakeLimiter(),
    );
    assert.equal(allowed.handled, false, `${method} ${path} should be allowed`);
    assert.ok(allowed.headers['RateLimit-Limit'], `${method} ${path} must be rate limited`);

    const missingKey = await enforceSecurity(
      { method, path, clientId: 'missing-key' },
      config,
      new FakeLimiter(),
    );
    assert.equal(missingKey.status, 401, `${method} ${path} must require a bearer key`);

    const blockedOrigin = await enforceSecurity(
      {
        method,
        path,
        origin: 'http://localhost:5173',
        authorization: `Bearer ${secret}`,
        clientId: 'blocked-origin',
      },
      config,
      new FakeLimiter(),
    );
    assert.equal(blockedOrigin.status, 403, `${method} ${path} must reject an untrusted origin`);

    const missingLimiter = await enforceSecurity(
      { method, path, authorization: `Bearer ${secret}`, clientId: 'redis-unavailable' },
      config,
    );
    assert.equal(missingLimiter.status, 503, `${method} ${path} must fail closed without Redis`);
  }
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
