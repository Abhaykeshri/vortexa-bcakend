import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

const requiredFiles = [
  '.github/workflows/ci.yml',
  '.railway/railway.ts',
  'docs/BACKUP_AND_RESTORE_RUNBOOK.md',
  'docs/INCIDENT_RECOVERY_RUNBOOK.md',
  'docs/OBSERVABILITY.md',
  'docs/PRODUCTION_READINESS_CHECKLIST.md',
  'docs/ROLLBACK_RUNBOOK.md',
  'docs/TIMELOCK_REMEDIATION.md',
  'scripts/inspect-timelock-governance.mjs',
  'scripts/inspect-operational-state.mjs',
  'scripts/verify-production-smoke.mjs',
];
const migrations = [
  '0001_m0_m5_foundation',
  '0002_m6_indexer',
  '0003_m5_outbox_m6_fencing',
  '0004_m7_vault_catalog',
  '0005_v2_ui_read_models',
];

const failures = [];
for (const file of requiredFiles) if (!existsSync(file)) failures.push(`missing file: ${file}`);
for (const migration of migrations) {
  for (const suffix of ['.sql', '.down.sql']) {
    const file = `packages/adapters/migrations/${migration}${suffix}`;
    if (!existsSync(file)) failures.push(`missing migration artifact: ${file}`);
    else {
      const checksum = createHash('sha256').update(readFileSync(file)).digest('hex');
      console.log(`Migration artifact ${basename(file)} sha256=${checksum}`);
    }
  }
}

const manifest = JSON.parse(readFileSync('packages/contracts/manifests/sepolia-v1.json', 'utf8'));
const contracts = Object.entries(manifest.contracts ?? {});
if (manifest.chainId !== 11155111) failures.push('deployment manifest is not Sepolia');
if (contracts.length !== 15) failures.push(`expected 15 contracts, found ${contracts.length}`);
for (const [key, contract] of contracts) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(contract.address ?? '')) failures.push(`invalid address: ${key}`);
  if (!/^0x[a-fA-F0-9]{64}$/.test(contract.runtimeCodeHash ?? ''))
    failures.push(`missing runtime hash: ${key}`);
}

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
for (const expected of ["node-version: '22'", 'npm ci --no-audit --no-fund', 'npm run ci'])
  if (!workflow.includes(expected)) failures.push(`CI requirement missing: ${expected}`);
const railway = readFileSync('.railway/railway.ts', 'utf8');
if (/preDeploy\s*:\s*['"].*migrat/i.test(railway))
  failures.push('Railway must not run production migrations automatically');

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Static release verification passed (${requiredFiles.length} release artifacts, 15 contracts)`);
}
