import { loadConfig } from './dist/apps/api/src/config/env.js';

const config = loadConfig();

for (const [name, value] of [
  ['PostgreSQL', config.databaseUrl],
  ['Redis', config.redisUrl],
]) {
  if (!value) {
    console.log(`${name}: NOT CONFIGURED`);
    continue;
  }

  const url = new URL(value);

  console.log(`${name}:`);
  console.log(`  Protocol: ${url.protocol}`);
  console.log(`  Railway internal host: ${url.hostname.endsWith('.railway.internal')}`);
  console.log(`  Port configured: ${Boolean(url.port)}`);
}
