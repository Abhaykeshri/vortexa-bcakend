import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadConfig } from '../dist/apps/api/src/config/env.js';

if (process.env.NODE_ENV !== 'production' && existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();
const services = [['API', 'dist/apps/api/src/main.js']];

// Workers depend on shared PostgreSQL/Redis state. Keep them opt-in for local
// startup so an unavailable worker dependency does not take down the API.
if (config.indexerEnabled && process.env.START_INDEXER === 'true')
  services.push(['INDEXER', 'dist/apps/indexer/src/main.js']);
if (process.env.START_OUTBOX === 'true') services.push(['OUTBOX', 'dist/apps/outbox/src/main.js']);

if (!config.indexerEnabled || process.env.START_INDEXER !== 'true')
  console.log('[INDEXER] not started; set INDEXER_ENABLED=true and START_INDEXER=true to enable');
if (process.env.START_OUTBOX !== 'true') console.log('[OUTBOX] not started; set START_OUTBOX=true to enable');

const children = [];
let stopping = false;

function stopAll() {
  if (stopping) return;
  stopping = true;

  for (const child of children) {
    if (child.exitCode === null) {
      child.kill();
    }
  }
}

for (const [name, script] of services) {
  const child = spawn(process.execPath, [script], {
    stdio: 'inherit',
    env: process.env,
  });

  children.push(child);

  child.on('error', (error) => {
    console.error(`[${name}] ${error.message}`);
    stopAll();
    process.exitCode = 1;
  });

  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[${name}] stopped: ${signal ?? code}`);
      stopAll();
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
