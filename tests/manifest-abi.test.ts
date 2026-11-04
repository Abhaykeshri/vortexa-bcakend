import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AbiEventDecoder } from '../packages/adapters/src/indexer/viem-source.js';
import { loadManifest } from '../packages/contracts/src/manifest.js';

type AbiParameter = { type?: unknown; components?: unknown };
type AbiEntry = {
  type?: unknown;
  name?: unknown;
  inputs?: unknown;
  outputs?: unknown;
  stateMutability?: unknown;
};

function validateParameters(value: unknown, context: string): void {
  assert.ok(Array.isArray(value), `${context}: parameters must be an array`);
  for (const [index, parameter] of value.entries()) {
    assert.ok(parameter && typeof parameter === 'object', `${context}[${index}]`);
    const item = parameter as AbiParameter;
    assert.equal(typeof item.type, 'string', `${context}[${index}].type`);
    assert.match(item.type as string, /^(?:address|bool|string|bytes(?:[1-9]|[12][0-9]|3[0-2])?|u?int(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?|tuple)(?:\[[0-9]*\])*$/);
    if ((item.type as string).startsWith('tuple'))
      validateParameters(item.components, `${context}[${index}].components`);
  }
}

test('canonical Sepolia manifest has 15 address-pinned contracts and identifies the Vault implementation', () => {
  const manifest = loadManifest();
  const entries = Object.values(manifest.contracts);
  assert.equal(entries.length, 15);
  assert.ok(entries.every((entry) => /^0x[a-fA-F0-9]{40}$/.test(entry.address ?? '')));
  assert.ok(entries.every((entry) => /^0x[a-f0-9]{64}$/.test(entry.runtimeCodeHash ?? '')));
  assert.equal(manifest.contracts.VAULT?.role, 'implementation');
  assert.equal(manifest.contracts.VAULT?.address, '0x258D4A053d9007F00e509088d79E0b99C9C47A1e');
});

test('all 15 current ABI files preserve valid entries, tuples, overloads, events and custom errors', () => {
  const manifest = loadManifest();
  for (const contract of Object.values(manifest.contracts)) {
    const abi = JSON.parse(
      readFileSync(`packages/adapters/abis/${contract.name}.json`, 'utf8').replace(/^\uFEFF/, ''),
    ) as AbiEntry[];
    assert.ok(Array.isArray(abi), contract.name);
    assert.ok(abi.some((entry) => entry.type === 'function'), contract.name);
    const signatures = new Set<string>();
    for (const [index, entry] of abi.entries()) {
      assert.ok(['constructor', 'error', 'event', 'fallback', 'function', 'receive'].includes(String(entry.type)), `${contract.name}[${index}].type`);
      if (['error', 'event', 'function'].includes(String(entry.type)))
        assert.equal(typeof entry.name, 'string', `${contract.name}[${index}].name`);
      if (entry.inputs !== undefined) validateParameters(entry.inputs, `${contract.name}[${index}].inputs`);
      if (entry.outputs !== undefined) validateParameters(entry.outputs, `${contract.name}[${index}].outputs`);
      if (['error', 'event', 'function'].includes(String(entry.type))) {
        const inputTypes = (entry.inputs as AbiParameter[]).map((input) => input.type).join(',');
        const signature = `${entry.type}:${String(entry.name)}(${inputTypes})`;
        assert.ok(!signatures.has(signature), `duplicate ABI signature: ${contract.name} ${signature}`);
        signatures.add(signature);
      }
    }
  }
});

test('ABI provenance identifies the supplied development commit without missing exports', () => {
  const provenance = JSON.parse(
    readFileSync('packages/adapters/abis/provenance.json', 'utf8').replace(/^\uFEFF/, ''),
  ) as {
    sourceBranch: string;
    sourceCommit: string;
    chainId: number;
    missing: unknown[];
    ambiguous: unknown[];
  };
  assert.equal(provenance.sourceBranch, 'development');
  assert.equal(provenance.sourceCommit, 'f64fade7334d01c5a48ebf276b70c493f9e520d6');
  assert.equal(provenance.chainId, 11155111);
  assert.deepEqual(provenance.missing, []);
  assert.deepEqual(provenance.ambiguous, []);
});

test('event decoder resolves ABI metadata for every registered contract', () => {
  const manifest = loadManifest();
  const contracts = Object.fromEntries(
    Object.entries(manifest.contracts).map(([key, contract]) => [key, contract.address!]),
  );
  assert.doesNotThrow(() => new AbiEventDecoder(contracts, manifest));
});
