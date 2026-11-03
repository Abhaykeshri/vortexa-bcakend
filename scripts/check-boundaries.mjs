import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
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
for (const file of walk('packages/application/src')) {
  if (!file.endsWith('.ts')) continue;
  const source = readFileSync(file, 'utf8');
  if (/from ['"](?:.*(?:adapters|apps)|drizzle-orm|redis|pg|viem)/.test(source))
    throw new Error(`Application boundary violation: ${file}`);
}
for (const file of walk('apps/api/src')) {
  if (!file.endsWith('.ts')) continue;
  const source = readFileSync(file, 'utf8');
  if (/\b(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:FROM|INTO|SET)\b/i.test(source))
    throw new Error(`SQL found in HTTP layer: ${file}`);
}

const roots = ['apps', 'packages'];
const files = roots.flatMap(walk).filter((file) => file.endsWith('.ts'));
const absoluteToFile = new Map(files.map((file) => [normalize(resolve(file)), file]));
const graph = new Map();
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const dependencies = [];
  for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const candidate = normalize(resolve(dirname(file), match[1].replace(/\.js$/, '.ts')));
    const dependency = absoluteToFile.get(candidate);
    if (dependency) dependencies.push(dependency);
  }
  graph.set(file, dependencies);
}
const visiting = new Set();
const visited = new Set();
function visit(file, path = []) {
  if (visiting.has(file)) throw new Error(`Circular dependency: ${[...path, file].join(' -> ')}`);
  if (visited.has(file)) return;
  visiting.add(file);
  for (const dependency of graph.get(file) ?? []) visit(dependency, [...path, file]);
  visiting.delete(file);
  visited.add(file);
}
for (const file of files) visit(file);
console.log('Hexagonal boundaries, HTTP SQL isolation and import-cycle checks passed');
