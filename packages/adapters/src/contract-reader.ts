import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, fallback, http, getAddress, keccak256 } from 'viem';
import { sepolia } from 'viem/chains';
import type { Abi, Address } from 'viem';

export class ContractReader {
  private readonly client;

  constructor(rpcUrl: string | readonly string[]) {
    const urls = typeof rpcUrl === 'string' ? [rpcUrl] : [...rpcUrl];
    const primary = urls[0];
    if (!primary) throw new Error('At least one RPC URL is required');
    this.client = createPublicClient({
      chain: sepolia,
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
    blockNumber?: bigint,
  ): Promise<unknown> {
    const abi = this.loadAbi(contractName);

    return this.client.readContract({
      address: getAddress(address),
      abi,
      functionName,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    });
  }
  async runtimeCodeHash(address: Address): Promise<`0x${string}`> {
    const code = await this.client.getCode({ address: getAddress(address) });
    if (!code || code === '0x') throw new Error('Contract bytecode missing');
    return keccak256(code);
  }
}
