import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const f = join(dir, name);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });
}
for (const file of walk('packages/domain/src')) {
  if (!file.endsWith('.ts')) continue;
  const source = readFileSync(file, 'utf8');
  if (/from ['"](?:node:|.*(?:adapters|application|apps|infra|drizzle|redis|viem))/.test(source))
    throw new Error(`Domain boundary violation: ${file}`);
}
console.log('Hexagonal domain boundary checks passed');
