import { defineRailway, group, preserve, project, service } from 'railway/iac';

/**
 * Declares the three independently deployable backend processes. Applying this
 * plan is an operator-controlled action; database migrations are deliberately
 * excluded from deployment hooks and must follow the approved migration runbook.
 */
export default defineRailway((context) => {
  const api = service('vortexa-api', {
    build: 'npm ci --include=dev --no-audit --no-fund && npm run build',
    start: 'npm run start',
    healthcheck: '/health/live',
    healthcheckTimeout: 120,
    replicas: 1,
    tracing: { enabled: true, autoInstrumentation: true },
    env: {
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      ACTIVE_CHAIN_ID: '11155111',
      CONTRACT_MANIFEST_PATH: 'packages/contracts/manifests/sepolia-v1.json',
      SEPOLIA_RPC_URL: preserve(),
      DATABASE_URL: preserve(),
      REDIS_URL: preserve(),
      CORS_ALLOWED_ORIGINS: preserve(),
      INTERNAL_API_KEY: preserve(),
      TRUST_PROXY: preserve(),
    },
  });

  const indexer = service('vortexa-indexer', {
    build: 'npm ci --include=dev --no-audit --no-fund && npm run build',
    start: 'npm run indexer:start',
    replicas: 1,
    env: {
      NODE_ENV: 'production',
      ACTIVE_CHAIN_ID: '11155111',
      CONTRACT_MANIFEST_PATH: 'packages/contracts/manifests/sepolia-v1.json',
      SEPOLIA_RPC_URL: preserve(),
      DATABASE_URL: preserve(),
      REDIS_URL: preserve(),
      INDEXER_ENABLED: 'true',
      INDEXER_START_BLOCK: '12032363',
      INDEXER_BATCH_SIZE: '500',
      INDEXER_HEADER_CONCURRENCY: '10',
      INDEXER_POLL_INTERVAL_MS: '12000',
      INDEXER_CONFIRMATIONS: '12',
      INDEXER_MAX_REORG_DEPTH: '128',
      INDEXER_WORKER_ID: preserve(),
    },
  });

  const outbox = service('vortexa-outbox', {
    build: 'npm ci --include=dev --no-audit --no-fund && npm run build',
    start: 'npm run outbox:start',
    replicas: 1,
    env: {
      NODE_ENV: 'production',
      DATABASE_URL: preserve(),
      REDIS_URL: preserve(),
      LOG_LEVEL: preserve(),
    },
  });

  return project(context.projectName ?? 'vortexa-backend', {
    resources: [group('VortexA Backend', [api, indexer, outbox])],
  });
});
