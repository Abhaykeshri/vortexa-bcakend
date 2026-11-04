import { loadConfig } from '../dist/apps/api/src/config/env.js';

const config = loadConfig();

/** Returns non-sensitive connection metadata without exposing credentials or provider paths. */
function connectionSummary(value) {
  if (!value) return { configured: false };
  const url = new URL(value);
  return {
    configured: true,
    protocol: url.protocol,
    railwayPrivateHost: url.hostname.endsWith('.railway.internal'),
    explicitPort: Boolean(url.port),
  };
}

console.log(
  JSON.stringify(
    {
      nodeEnvironment: config.nodeEnv,
      bindHost: config.host,
      port: config.port,
      chainId: config.chainId,
      rpcProviderCount: config.rpcUrls.length,
      manifestVersion: config.manifestVersion,
      contractCount: Object.keys(config.contracts).length,
      corsOriginCount: config.corsAllowedOrigins.length,
      trustProxy: config.trustProxy,
      indexerEnabled: config.indexerEnabled,
      postgres: connectionSummary(config.databaseUrl),
      redis: connectionSummary(config.redisUrl),
    },
    null,
    2,
  ),
);
