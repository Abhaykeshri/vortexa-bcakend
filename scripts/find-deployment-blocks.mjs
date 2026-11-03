import { loadConfig } from '../dist/apps/api/src/config/env.js';

const config = loadConfig();
let requestId = 0;
async function rpc(method, params) {
  const response = await fetch(config.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error || body.result === undefined) throw new Error('RPC request failed');
  return body.result;
}

if (BigInt(await rpc('eth_chainId', [])) !== BigInt(config.chainId)) throw new Error('RPC chain mismatch');
const latest = BigInt(await rpc('eth_blockNumber', []));
let overallStart = latest;
for (const [name, address] of Object.entries(config.contracts)) {
  let low = 0n;
  let high = latest;
  while (low < high) {
    const mid = (low + high) / 2n;
    const code = await rpc('eth_getCode', [address, `0x${mid.toString(16)}`]);
    if (code === '0x') low = mid + 1n;
    else high = mid;
  }
  const code = await rpc('eth_getCode', [address, `0x${low.toString(16)}`]);
  if (code === '0x') throw new Error(`No deployment bytecode found for ${name}`);
  overallStart = low < overallStart ? low : overallStart;
  console.log(`${name}: ${low}`);
}
console.log(`Earliest verified deployment block: ${overallStart}`);
