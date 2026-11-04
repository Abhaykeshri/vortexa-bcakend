import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config/env.js';
import type { ApiDependencies } from '../apps/api/src/http-context.js';
import { startApiServer } from '../apps/api/src/server.js';
import { loadManifest } from '../packages/contracts/src/manifest.js';

const manifest = loadManifest();
const contractEnvironment = Object.fromEntries(
  Object.keys(manifest.contracts).map((key) => [`CONTRACT_${key}`, `0x${'1'.repeat(40)}`]),
);
const internalApiKey = 'test-internal-key-with-at-least-32-characters';
const config = loadConfig({
  NODE_ENV: 'test',
  ...contractEnvironment,
  SEPOLIA_RPC_URL: 'https://rpc.example.org',
  CORS_ALLOWED_ORIGINS: 'https://app.example.org',
  INTERNAL_API_KEY: internalApiKey,
  MAX_REQUEST_BODY_BYTES: '1024',
}, manifest);

function dependencies(overrides: Partial<ApiDependencies> = {}): ApiDependencies {
  return {
    config,
    chain: {
      verifyNetwork: async () => undefined,
      latestBlock: async () => 123n,
      finalizedBlock: async () => 111n,
      inspect: async () => ({ deployed: true }),
    },
    contractReader: {
      runtimeCodeHash: async () => `0x${'2'.repeat(64)}`,
      read: async () => `0x${'1'.repeat(40)}`,
    },
    contractRegistry: { resolve: () => `0x${'1'.repeat(40)}` },
    limiter: { rateLimit: async (_scope, limit) => ({ allowed: true, remaining: limit - 1 }) },
    checkPostgres: async () => true,
    checkRedis: async () => true,
    log: () => undefined,
    ...overrides,
  };
}

test('Express application registers routes and preserves response schema and request IDs', async () => {
  const response = await request(createApp(dependencies())).get('/api/v1/chain/status').expect(200);
  assert.equal(response.body.chainId, 11155111);
  assert.equal(response.body.latestBlock, '123');
  assert.equal(response.body.safeConfirmationBlock, '111');
  assert.match(response.body.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(response.headers['x-request-id'], response.body.requestId);
  assert.equal(response.headers['x-powered-by'], undefined);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('Helmet and CORS middleware enforce restrictive browser policy', async () => {
  const app = createApp(dependencies());
  const allowed = await request(app)
    .get('/api/v1/network')
    .set('Origin', 'https://app.example.org')
    .expect(200);
  assert.match(String(allowed.headers['content-security-policy']), /default-src 'none'/);
  assert.equal(allowed.headers['x-content-type-options'], 'nosniff');
  assert.equal(allowed.headers['x-frame-options'], 'DENY');
  assert.equal(allowed.headers['referrer-policy'], 'no-referrer');
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://app.example.org');
  assert.equal(allowed.headers['strict-transport-security'], undefined);
  await request(app).get('/api/v1/network').set('Origin', 'https://evil.example').expect(403);
});

test('authentication, preflight and Redis-backed fail-closed rate limiting run before controllers', async () => {
  const app = createApp(dependencies());
  await request(app).get('/health/ready').expect(401, /UNAUTHORIZED/);
  await request(app)
    .get('/health/ready')
    .set('Authorization', `Bearer ${internalApiKey}`)
    .expect(503);
  const preflight = await request(app)
    .options('/api/v1/network')
    .set('Origin', 'https://app.example.org')
    .set('Access-Control-Request-Method', 'GET')
    .expect(204);
  assert.equal(preflight.headers['access-control-allow-methods'], 'GET');
  const withoutLimiter = dependencies();
  delete (withoutLimiter as { limiter?: ApiDependencies['limiter'] }).limiter;
  await request(createApp(withoutLimiter)).get('/api/v1/network').expect(503);
});

test('payload limits, malformed JSON and unsupported methods return safe errors', async () => {
  const app = createApp(dependencies());
  await request(app).get('/health/live').set('Content-Length', '1025').expect(413, /PAYLOAD_TOO_LARGE/);
  await request(app)
    .post('/unknown')
    .set('Content-Type', 'application/json')
    .send('{invalid')
    .expect(400, /INVALID_JSON/);
  await request(app).post('/unknown').send({ ok: true }).expect(405, /METHOD_NOT_ALLOWED/);
});

test('M7 route validation and missing projections preserve safe status codes', async () => {
  const app = createApp(dependencies());
  await request(app).get('/api/v1/vaults?limit=0').expect(400, /INVALID_LIMIT/);
  await request(app).get('/api/v1/vaults').expect(503, /PROJECTION_UNAVAILABLE/);
  await request(app).get('/api/v1/vaults/not-an-address').expect(400, /INVALID_ADDRESS/);
  await request(app).get('/api/v1/network?chainId=1').expect(400, /INVALID_CHAIN_ID/);
});

test('central error handling sanitizes upstream errors', async () => {
  const app = createApp(dependencies({
    chain: {
      verifyNetwork: async () => { throw new Error('rpc secret in upstream URL'); },
      latestBlock: async () => 0n,
      finalizedBlock: async () => 0n,
      inspect: async () => ({}),
    },
  }));
  const response = await request(app).get('/api/v1/chain/status').expect(503);
  assert.equal(response.body.error, 'UPSTREAM_UNAVAILABLE');
  assert.doesNotMatch(response.text, /rpc secret/);
});

test('graceful shutdown closes injected dependencies', async () => {
  let closed = false;
  const server = startApiServer({
    app: createApp(dependencies()),
    host: '127.0.0.1',
    port: 0,
    log: () => undefined,
    closeDependencies: async () => { closed = true; },
  });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  process.emit('SIGTERM');
  await new Promise<void>((resolve) => server.once('close', resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(closed, true);
});
