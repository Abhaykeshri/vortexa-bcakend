import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadManifest } from '../packages/contracts/src/manifest.js';
test('versioned Sepolia manifest has 12 contracts and pinned code hashes without addresses', () => {
  const m = loadManifest();
  const entries = Object.values(m.contracts);
  assert.equal(entries.length, 12);
  assert.ok(entries.every((x) => !('address' in x)));
  assert.ok(entries.every((x) => /^0x[a-f0-9]{64}$/.test(x.runtimeCodeHash ?? '')));
});
test('each manifest contract has a local ABI with callable entries', () => {
  const m = loadManifest();
  for (const c of Object.values(m.contracts)) {
    const abi = JSON.parse(
      readFileSync(`packages/adapters/abis/${c.name}.json`, 'utf8').replace(/^\uFEFF/, ''),
    ) as Array<{ type: string }>;
    assert.ok(Array.isArray(abi));
    assert.ok(
      abi.some((x) => x.type === 'function'),
      c.name,
    );
  }
});
