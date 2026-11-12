import { readFileSync } from 'node:fs';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, '')];
    }),
);
const abi = JSON.parse(
  readFileSync('packages/adapters/abis/PriceGuard.json', 'utf8').replace(/^\uFEFF/, ''),
);
const client = createPublicClient({
  chain: sepolia,
  transport: http(env.CHAIN_RPC_URL || env.SEPOLIA_RPC_URL),
});
const address = '0x5288B03FA0d74a7fE2d59611C360E50E77aC4bE3';
const key = [
  '0x0000000000000000000000000000000000000000',
  '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  2345,
  25,
  '0x0000000000000000000000000000000000000000',
];
const [owner, pendingOwner, config, trust, reference] = await Promise.all([
  client.readContract({ address, abi, functionName: 'owner' }),
  client.readContract({ address, abi, functionName: 'pendingOwner' }),
  client.readContract({ address, abi, functionName: 'configOf', args: [key] }),
  client.readContract({ address, abi, functionName: 'isPriceTrusted', args: [key] }),
  client.readContract({ address, abi, functionName: 'referenceSqrtPriceX96', args: [key] }),
]);
console.log(
  JSON.stringify(
    { owner, pendingOwner, config, trust, reference },
    (_, value) => (typeof value === 'bigint' ? value.toString() : value),
    2,
  ),
);
