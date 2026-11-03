import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const directory = join('dist', 'tests');
const files = readdirSync(directory)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => join(directory, name));

if (files.length === 0) throw new Error('No compiled test files found');
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
