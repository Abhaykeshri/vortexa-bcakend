import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, defineChain, fallback, http, getAddress, keccak256 } from 'viem';
import type { Abi, Address } from 'viem';

export class ContractReader {
  private readonly client;

  constructor(rpcUrl: string | readonly string[], chainId = 11155111) {
    const urls = typeof rpcUrl === 'string' ? [rpcUrl] : [...rpcUrl];
    const primary = urls[0];
    if (!primary) throw new Error('At least one RPC URL is required');
    this.client = createPublicClient({
      chain: defineChain({
        id: chainId,
        name: chainId === 11155111 ? 'Ethereum Sepolia' : `EVM ${chainId}`,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: urls } },
      }),
      transport:
        urls.length === 1
          ? http(primary, { timeout: 10000, retryCount: 1 })
          : fallback(urls.map((url) => http(url, { timeout: 10000, retryCount: 1 }))),
    });
  }

  private loadAbi(name: string): Abi {
    const url = new URL(`../../../../packages/adapters/abis/${name}.json`, import.meta.url);
    return JSON.parse(readFileSync(fileURLToPath(url), 'utf8').replace(/^\uFEFF/, '')) as Abi;
  }

  async read(
    contractName: string,
    address: Address,
    functionName: string,
    args: readonly unknown[] = [],
    blockNumber?: bigint,
  ): Promise<unknown> {
    const abi = this.loadAbi(contractName);

    return this.client.readContract({
      address: getAddress(address),
      abi,
      functionName,
      args,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    });
  }
  async blockHash(blockNumber: bigint): Promise<`0x${string}`> {
    const block = await this.client.getBlock({ blockNumber });
    if (!block.hash) throw new Error('Pinned block hash unavailable');
    return block.hash;
  }
  async runtimeCodeHash(address: Address): Promise<`0x${string}`> {
    const code = await this.client.getCode({ address: getAddress(address) });
    if (!code || code === '0x') throw new Error('Contract bytecode missing');
    return keccak256(code);
  }
}
