import type { RequestHandler } from 'express';
import type { ApiDependencies } from '../http-context.js';
import { presentJson } from '../presenters/json.js';

export function healthController(dependencies: ApiDependencies): {
  live: RequestHandler;
  ready: RequestHandler;
} {
  return {
    live: (_req, res) => presentJson(res, 200, { status: 'ok' }),
    ready: async (_req, res, next) => {
      const { config, chain, contractReader } = dependencies;
      const services: Record<string, string> = {
        sepolia: 'pending',
        postgres: config.databaseUrl ? 'pending' : 'not_configured',
        redis: config.redisUrl ? 'pending' : 'not_configured',
        contracts: 'pending',
      };
      try {
        const checks = await Promise.allSettled([
          chain.verifyNetwork(),
          config.databaseUrl ? dependencies.checkPostgres() : Promise.resolve(false),
          config.redisUrl ? dependencies.checkRedis() : Promise.resolve(false),
          Promise.all(
            Object.entries(config.contracts).map(async ([key, address]) => {
              const expected = config.contractCodeHashes[key as keyof typeof config.contracts];
              if (!expected) throw new Error('Missing pinned code hash');
              const actual = await contractReader.runtimeCodeHash(address);
              if (actual.toLowerCase() !== expected.toLowerCase())
                throw new Error('Runtime code hash mismatch');
            }),
          ),
        ]);
        services.sepolia = checks[0]?.status === 'fulfilled' ? 'ready' : 'unavailable';
        if (config.databaseUrl)
          services.postgres = checks[1]?.status === 'fulfilled' && checks[1].value === true
            ? 'ready'
            : 'unavailable';
        if (config.redisUrl)
          services.redis = checks[2]?.status === 'fulfilled' && checks[2].value === true
            ? 'ready'
            : 'unavailable';
        services.contracts = checks[3]?.status === 'fulfilled' ? 'ready' : 'unavailable';
        const ready = Object.values(services).every((value) => value === 'ready');
        presentJson(res, ready ? 200 : 503, {
          status: ready ? 'ready' : 'not_ready',
          chainId: config.chainId,
          services,
        });
      } catch (error) {
        next(error);
      }
    },
  };
}
