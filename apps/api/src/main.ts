import pg from 'pg';
import { checkPostgres, checkRedis } from '../../../packages/adapters/src/service-health.js';
import { connectRedis, RedisCoordinationAdapter } from '../../../packages/adapters/src/redis-coordination.js';
import { ChainAwareContractReader, ChainRegistry, ContractRegistry, RpcClientFactory } from '../../../packages/adapters/src/chain-registry.js';
import { DrizzleM7VaultRepository } from '../../../packages/adapters/src/postgres/m7-repository.js';
import { M7QueryService } from '../../../packages/application/src/m7-queries.js';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import type { ApiDependencies } from './http-context.js';
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
  const chains = new ChainRegistry([{
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
  }], config.chainId);
  const chain = new RpcClientFactory(chains).create(config.chainId);
  const contractReader = new ChainAwareContractReader(chains).reader(config.chainId);
  const contractRegistry = new ContractRegistry(chains);
  const postgresPool = config.databaseUrl
    ? new pg.Pool({ connectionString: config.databaseUrl, max: 4, application_name: 'vortexa-api' })
    : undefined;
  let responseCache: RedisCoordinationAdapter | undefined;
  let closeRedis: (() => Promise<void>) | undefined;
  if (config.redisUrl) {
    try {
      const redis = await connectRedis(config.redisUrl);
      responseCache = new RedisCoordinationAdapter(redis);
      closeRedis = async () => { await redis.quit(); };
    } catch {
      log('error', 'redis_connection_unavailable');
    }
  }
  const repository = postgresPool ? new DrizzleM7VaultRepository(postgresPool) : undefined;
  const dependencies: ApiDependencies = {
    config,
    chain,
    contractReader,
    contractRegistry,
    ...(repository ? {
      m7Service: new M7QueryService(repository, chain, responseCache, config.m7StaleAfterBlocks, {
        vaults: config.m7VaultListCacheTtlSeconds,
        detail: config.m7VaultDetailCacheTtlSeconds,
        events: config.m7VaultEventsCacheTtlSeconds,
        positions: config.m7PositionsCacheTtlSeconds,
      }),
    } : {}),
    ...(responseCache ? { limiter: responseCache } : {}),
    checkPostgres: () => config.databaseUrl ? checkPostgres(config.databaseUrl) : Promise.resolve(false),
    checkRedis: () => config.redisUrl ? checkRedis(config.redisUrl) : Promise.resolve(false),
    log,
  };
  startApiServer({
    app: createApp(dependencies),
    host: config.host,
    port: config.port,
    log,
    closeDependencies: async () => {
      await closeRedis?.();
      await postgresPool?.end();
    },
  });
}

void start().catch((error: unknown) => {
  console.error('API startup failed', error instanceof Error ? error.message : 'unknown');
  process.exitCode = 1;
});
