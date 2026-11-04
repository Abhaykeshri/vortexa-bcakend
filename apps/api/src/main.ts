import pg from 'pg';
import { checkPostgres, checkRedis } from '../../../packages/adapters/src/service-health.js';
import {
  connectRedis,
  RedisCoordinationAdapter,
} from '../../../packages/adapters/src/redis-coordination.adapter.js';
import {
  ChainAwareContractReader,
  ChainRegistry,
  ContractRegistry,
  RpcClientFactory,
} from '../../../packages/adapters/src/chain-registry.js';
import { DrizzleVaultProjectionRepository } from '../../../packages/adapters/src/postgres/vault-projection.repository.js';
import { VaultQueryService } from '../../../packages/application/src/vault-query.service.js';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import type { ApiDependencies } from './api-dependencies.js';
import { startApiServer } from './server.js';

async function start(): Promise<void> {
  const config = loadConfig();
  const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
  const log: ApiDependencies['log'] = (level, event, detail = {}) => {
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
  const postgresPool = config.databaseUrl
    ? new pg.Pool({
        connectionString: config.databaseUrl,
        max: 4,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        statement_timeout: 8000,
        query_timeout: 9000,
        application_name: 'vortexa-api',
      })
    : undefined;
  postgresPool?.on('error', (error) => log('error', 'postgres_pool_error', { errorType: error.name }));
  let responseCache: RedisCoordinationAdapter | undefined;
  let closeRedis: (() => Promise<void>) | undefined;
  if (config.redisUrl) {
    try {
      const redis = await connectRedis(config.redisUrl, (error) =>
        log('error', 'redis_client_error', {
          errorType: error instanceof Error ? error.name : 'unknown',
        }),
      );
      responseCache = new RedisCoordinationAdapter(redis);
      closeRedis = async () => {
        await redis.quit();
      };
    } catch {
      log('error', 'redis_connection_unavailable');
    }
  }
  const repository = postgresPool ? new DrizzleVaultProjectionRepository(postgresPool) : undefined;
  const dependencies: ApiDependencies = {
    config,
    chain,
    contractReader,
    contractRegistry,
    ...(repository
      ? {
          vaultQueryService: new VaultQueryService(
            repository,
            chain,
            responseCache,
            config.projectionStaleAfterBlocks,
            {
              vaults: config.vaultListCacheTtlSeconds,
              detail: config.vaultDetailCacheTtlSeconds,
              events: config.vaultEventsCacheTtlSeconds,
              positions: config.walletPositionsCacheTtlSeconds,
            },
          ),
        }
      : {}),
    ...(responseCache ? { limiter: responseCache } : {}),
    checkPostgres: () => (config.databaseUrl ? checkPostgres(config.databaseUrl) : Promise.resolve(false)),
    checkRedis: () => (config.redisUrl ? checkRedis(config.redisUrl) : Promise.resolve(false)),
    log,
  };
  startApiServer({
    app: createApp(dependencies),
    host: config.host,
    port: config.port,
    shutdownGracePeriodMs: config.shutdownGracePeriodMs,
    log,
    closeDependencies: async () => {
      await closeRedis?.();
      await postgresPool?.end();
    },
  });
}

void start().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'api_start_failed',
      errorType: error instanceof Error ? error.name : 'unknown',
    }),
  );
  process.exitCode = 1;
});
