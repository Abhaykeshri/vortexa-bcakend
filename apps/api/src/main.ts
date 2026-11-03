import { checkPostgres, checkRedis } from '../../../packages/adapters/src/service-health.js';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadConfig, publicConfig } from './config/env.js';
import { connectRedis, RedisCoordinationAdapter } from '../../../packages/adapters/src/redis-coordination.js';
import {
  ChainAwareContractReader,
  ChainRegistry,
  ContractRegistry,
  RpcClientFactory,
  UnsupportedChainError,
} from '../../../packages/adapters/src/chain-registry.js';
import {
  enforceSecurity,
  httpSecurityHeaders,
  rateLimitClientId,
  responseWithRequestId,
  serializeJsonResponse,
  validateContentLength,
  type RateLimiter,
} from './security.js';
import { DrizzleM7VaultRepository } from '../../../packages/adapters/src/postgres/m7-repository.js';
import { M7QueryService } from '../../../packages/application/src/m7-queries.js';
import { handleM7HttpRequest } from './m7-http.js';

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function start(): Promise<void> {
  const config = loadConfig();
  const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
  const log = (level: keyof typeof levels, event: string, detail: Record<string, unknown> = {}) => {
    if (levels[level] < levels[config.logLevel]) return;
    const line = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...detail });
    if (level === 'error') console.error(line);
    else console.log(line);
  };
  const chains = new ChainRegistry(
    [
      {
        chainId: config.chainId,
        name: 'Ethereum Sepolia',
        enabled: true,
        rpcUrls: config.rpcUrls,
        rpcTimeoutMs: config.rpcTimeoutMs,
        rpcMaxRetries: config.rpcMaxRetries,
        confirmations: config.confirmations,
        manifest: config.manifest,
        contracts: config.contracts,
        capabilities: {},
      },
    ],
    config.chainId,
  );
  const chain = new RpcClientFactory(chains).create(config.chainId);
  const contractReader = new ChainAwareContractReader(chains).reader(config.chainId);
  const contractRegistry = new ContractRegistry(chains);
  let limiter: RateLimiter | undefined;
  let responseCache: RedisCoordinationAdapter | undefined;
  let closeRedis: (() => Promise<void>) | undefined;
  const postgresPool = config.databaseUrl
    ? new pg.Pool({
        connectionString: config.databaseUrl,
        max: 4,
        application_name: 'vortexa-api',
      })
    : undefined;
  const m7Repository = postgresPool ? new DrizzleM7VaultRepository(postgresPool) : undefined;
  if (config.redisUrl) {
    void connectRedis(config.redisUrl)
      .then((redis) => {
        responseCache = new RedisCoordinationAdapter(redis);
        limiter = responseCache;
        closeRedis = async () => {
          await redis.quit();
        };
      })
      .catch(() => {
        log('error', 'redis_connection_unavailable');
      });
  }
  const handleRequest = async (req: IncomingMessage, res: ServerResponse, requestId: string) => {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    const path = requestUrl.pathname;
    for (const [name, value] of Object.entries(httpSecurityHeaders(config.nodeEnv === 'production')))
      res.setHeader(name, value);
    res.setHeader('Cache-Control', 'no-store');
    const send = (status: number, data: unknown) => {
      res.writeHead(status);
      res.end(status === 204 ? undefined : serializeJsonResponse(responseWithRequestId(data, requestId)));
    };
    try {
      validateContentLength(header(req.headers['content-length']), config.maxRequestBodyBytes);
    } catch (error) {
      send(error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400, {
        error:
          error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE'
            ? 'PAYLOAD_TOO_LARGE'
            : 'INVALID_CONTENT_LENGTH',
      });
      return;
    }
    const directClient = req.socket.remoteAddress ?? 'unknown';
    const forwardedFor = req.headers['x-forwarded-for'];
    const forwardedClient = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
    const decision = await enforceSecurity(
      {
        method: req.method ?? 'GET',
        path,
        clientId: rateLimitClientId(directClient, forwardedClient, config.trustProxy),
        ...(req.headers.origin ? { origin: req.headers.origin } : {}),
        ...(header(req.headers.authorization) ? { authorization: header(req.headers.authorization)! } : {}),
        ...(header(req.headers['access-control-request-method'])
          ? { requestedMethod: header(req.headers['access-control-request-method'])! }
          : {}),
        ...(header(req.headers['access-control-request-headers'])
          ? { requestedHeaders: header(req.headers['access-control-request-headers'])! }
          : {}),
      },
      config,
      limiter,
    );
    for (const [name, value] of Object.entries(decision.headers)) res.setHeader(name, value);
    if (decision.handled) {
      send(decision.status ?? 500, decision.body);
      return;
    }
    if (req.method !== 'GET') {
      send(405, { error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    try {
      const requestedChain = requestUrl.searchParams.get('chainId');
      if (requestedChain !== null && path.startsWith('/api/v1/')) {
        if (!/^[1-9][0-9]*$/.test(requestedChain)) {
          send(400, { error: 'INVALID_CHAIN_ID' });
          return;
        }
        chains.resolve(Number(requestedChain));
      }
      if (path === '/health/live') {
        send(200, { status: 'ok' });
        return;
      }
      if (path === '/api/v1/network') {
        send(200, publicConfig(config));
        return;
      }
      if (path === '/health/ready') {
        const services: Record<string, string> = {
          sepolia: 'pending',
          postgres: config.databaseUrl ? 'pending' : 'not_configured',
          redis: config.redisUrl ? 'pending' : 'not_configured',
          contracts: 'pending',
        };

        const checks = await Promise.allSettled([
          chain.verifyNetwork(),
          config.databaseUrl ? checkPostgres(config.databaseUrl) : Promise.resolve(false),
          config.redisUrl ? checkRedis(config.redisUrl) : Promise.resolve(false),
          Promise.all(
            Object.entries(config.contracts).map(async ([key, address]) => {
              const expected = config.contractCodeHashes[key as keyof typeof config.contracts];
              if (!expected) throw new Error('Missing pinned code hash');
              if ((await contractReader.runtimeCodeHash(address)).toLowerCase() !== expected.toLowerCase())
                throw new Error('Runtime code hash mismatch');
            }),
          ),
        ]);

        services.sepolia = checks[0]?.status === 'fulfilled' ? 'ready' : 'unavailable';

        if (config.databaseUrl) {
          services.postgres =
            checks[1]?.status === 'fulfilled' && checks[1].value === true ? 'ready' : 'unavailable';
        }

        if (config.redisUrl) {
          services.redis =
            checks[2]?.status === 'fulfilled' && checks[2].value === true ? 'ready' : 'unavailable';
        }
        services.contracts = checks[3]?.status === 'fulfilled' ? 'ready' : 'unavailable';

        const ready = Object.values(services).every((x) => x === 'ready');

        send(ready ? 200 : 503, {
          status: ready ? 'ready' : 'not_ready',
          chainId: config.chainId,
          services,
        });
        return;
      }
      if (path === '/api/v1/chain/status') {
        await chain.verifyNetwork();
        const latest = await chain.latestBlock();
        const finalized = await chain.finalizedBlock(config.chainId);
        send(200, {
          chainId: config.chainId,
          latestBlock: latest.toString(),
          safeConfirmationBlock: finalized.toString(),
          confirmationDepth: config.confirmations,
        });
        return;
      }
      if (path === '/api/v1/contracts/status') {
        await chain.verifyNetwork();
        const results = await Promise.all(
          Object.keys(config.contracts).map(async (name) => ({
            name,
            ...(await chain.inspect(contractRegistry.resolve(config.chainId, name))),
          })),
        );
        send(200, { chainId: config.chainId, contracts: results });
        return;
      }
      if (path === '/api/v1/contracts/wiring') {
        await chain.verifyNetwork();

        const checks = [
          ['VAULT_FACTORY', 'VaultFactory', 'swapExecutor', 'SWAP_EXECUTOR'],
          ['ZAP', 'Zap', 'factory', 'VAULT_FACTORY'],
          ['ZAP', 'Zap', 'executor', 'SWAP_EXECUTOR'],
          ['SWAP_EXECUTOR', 'SwapExecutor', 'factory', 'VAULT_FACTORY'],
          ['SWAP_EXECUTOR', 'SwapExecutor', 'zap', 'ZAP'],
        ] as const;

        const results = await Promise.all(
          checks.map(async ([key, name, getter, expectedKey]) => {
            const actual = await contractReader.read(name, config.contracts[key], getter);
            const expected = config.contracts[expectedKey];

            return {
              contract: name,
              getter,
              expected,
              actual: String(actual),
              passed: String(actual).toLowerCase() === expected.toLowerCase(),
            };
          }),
        );

        const passed = results.filter((x) => x.passed).length;

        send(passed === results.length ? 200 : 409, {
          chainId: config.chainId,
          passed,
          total: results.length,
          checks: results,
        });
        return;
      }
      if (path.startsWith('/api/v1/vaults') || path.startsWith('/api/v1/wallets/')) {
        if (!m7Repository) {
          send(503, { error: 'PROJECTION_UNAVAILABLE' });
          return;
        }
        const m7 = await handleM7HttpRequest({
          url: requestUrl,
          path,
          chainId: config.chainId,
          service: new M7QueryService(m7Repository, chain, responseCache, config.m7StaleAfterBlocks, {
            vaults: config.m7VaultListCacheTtlSeconds,
            detail: config.m7VaultDetailCacheTtlSeconds,
            events: config.m7VaultEventsCacheTtlSeconds,
            positions: config.m7PositionsCacheTtlSeconds,
          }),
          defaultLimit: config.m7PageDefault,
          maxLimit: config.m7PageMax,
        });
        if (m7) {
          send(m7.status, m7.body);
          return;
        }
      }
      send(404, { error: 'NOT_FOUND' });
    } catch (e) {
      if (e instanceof UnsupportedChainError) {
        send(400, { error: 'UNSUPPORTED_CHAIN' });
        return;
      }
      log('error', 'request_failed', { errorType: e instanceof Error ? e.name : 'unknown' });
      send(503, { error: 'UPSTREAM_UNAVAILABLE' });
    }
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    void handleRequest(req, res, requestId).catch((error: unknown) => {
      log('error', 'request_handler_failed', {
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(serializeJsonResponse(responseWithRequestId({ error: 'UPSTREAM_UNAVAILABLE' }, requestId)));
      } else if (!res.writableEnded) res.end();
    });
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 8000;
  server.listen(config.port, config.host, () =>
    log('info', 'api_listening', { host: config.host, port: config.port, chainId: config.chainId }),
  );
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'shutdown_started', { signal });
    server.close(() => {
      void (async () => {
        try {
          await closeRedis?.();
          await postgresPool?.end();
          log('info', 'shutdown_complete');
        } catch {
          process.exitCode = 1;
          log('error', 'shutdown_dependency_error');
        }
      })();
    });
    server.closeIdleConnections();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

void start().catch((error: unknown) => {
  console.error('API startup failed', error instanceof Error ? error.message : 'unknown');
  process.exitCode = 1;
});
