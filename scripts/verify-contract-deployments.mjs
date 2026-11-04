import { existsSync, readFileSync } from 'node:fs';
import { keccak256 } from 'viem';

function localEnvironment() {
  if (!existsSync('.env')) return {};
  return Object.fromEntries(
    readFileSync('.env', 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        const value = line.slice(separator + 1).trim();
        return [
          line.slice(0, separator).trim(),
          value.replace(
            /^(?:"(.*)"|'(.*)')$/,
            (_match, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted,
          ),
        ];
      }),
  );
}

const environment = { ...localEnvironment(), ...process.env };
const rpcUrl = (environment.SEPOLIA_RPC_URLS ?? environment.SEPOLIA_RPC_URL ?? '').split(',')[0]?.trim();
if (!rpcUrl) throw new Error('No Sepolia RPC endpoint is configured');
const manifest = JSON.parse(readFileSync('packages/contracts/manifests/sepolia-v1.json', 'utf8'));
let requestId = 0;
async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
  });
  if (!response.ok) throw new Error(`RPC HTTP failure: ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`RPC method failed: ${method} (${String(body.error.code)})`);
  return body.result;
}

const chainId = Number.parseInt(await rpc('eth_chainId'), 16);
if (chainId !== manifest.chainId) throw new Error(`RPC chain mismatch: ${chainId}`);
let failed = false;
for (const [key, contract] of Object.entries(manifest.contracts)) {
  if (!contract.address) throw new Error(`Manifest address missing: ${key}`);
  const code = await rpc('eth_getCode', [contract.address, 'latest']);
  const bytes = code === '0x' ? 0 : (code.length - 2) / 2;
  const actualHash = bytes === 0 ? undefined : keccak256(code);
  const matches = Boolean(actualHash && contract.runtimeCodeHash && actualHash === contract.runtimeCodeHash);
  if (!matches) failed = true;
  console.log(
    JSON.stringify({
      contract: key,
      address: contract.address,
      bytes,
      actualHash,
      expectedHash: contract.runtimeCodeHash,
      matches,
    }),
  );
}
if (failed) process.exitCode = 1;
