import { checkPostgres, checkRedis } from '../../../packages/adapters/src/service-health.js';
import { ContractReader } from '../../../packages/adapters/src/contract-reader.js';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadConfig, publicConfig } from './config/env.js';
import { JsonRpcHttpAdapter, SepoliaReadAdapter } from '../../../packages/adapters/src/sepolia-rpc.js';
import { connectRedis, RedisCoordinationAdapter } from '../../../packages/adapters/src/redis-coordination.js';
import { enforceSecurity, type RateLimiter } from './security.js';

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function start(): Promise<void> {
  const config = loadConfig();
  const rpc = new JsonRpcHttpAdapter(config.rpcUrl, config.rpcTimeoutMs, config.rpcMaxRetries);
  const chain = new SepoliaReadAdapter(rpc, config.confirmations, config.chainId);
  const contractReader = new ContractReader(config.rpcUrls);
  let limiter: RateLimiter | undefined;
  if (config.redisUrl) {
    void connectRedis(config.redisUrl)
      .then((redis) => {
        limiter = new RedisCoordinationAdapter(redis);
      })
      .catch(() => {
        console.error('Redis security dependency unavailable');
      });
  }
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (status: number, data: unknown) => {
      res.writeHead(status);
      res.end(status === 204 ? undefined : JSON.stringify(data));
    };
    const directClient = req.socket.remoteAddress ?? 'unknown';
    const forwardedClient = header(req.headers['x-forwarded-for'])?.split(',')[0]?.trim();
    const decision = await enforceSecurity(
      {
        method: req.method ?? 'GET',
        path,
        clientId: config.trustProxy && forwardedClient ? forwardedClient : directClient,
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
          Object.entries(config.contracts).map(async ([name, address]) => ({
            name,
            ...(await chain.inspect(address)),
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
      send(404, { error: 'NOT_FOUND' });
    } catch (e) {
      console.error('request failed', e instanceof Error ? e.name : 'unknown');
      send(503, { error: 'UPSTREAM_UNAVAILABLE' });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 8000;
  server.listen(config.port, config.host, () =>
    console.log(`VortexA API listening on ${config.host}:${config.port}`),
  );
}

void start().catch((error: unknown) => {
  console.error('API startup failed', error instanceof Error ? error.message : 'unknown');
  process.exitCode = 1;
});
