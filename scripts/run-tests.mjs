import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Derive compiled test paths from current sources so renamed tests cannot leave
// stale JavaScript in dist that is accidentally executed by a later run.
const files = readdirSync('tests')
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => join('dist', 'tests', name.replace(/\.ts$/, '.js')));

if (files.length === 0) throw new Error('No compiled test files found');
for (const file of files) if (!existsSync(file)) throw new Error(`Compiled test is missing: ${file}`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
