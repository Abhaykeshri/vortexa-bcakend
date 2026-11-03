import type { Address } from '../../domain/src/types.js';
import type { ChainStatePort } from '../../domain/src/ports.js';

export interface RpcTransport {
  request(method: string, params?: unknown[]): Promise<unknown>;
}
export class RpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RpcError';
  }
}
export class JsonRpcHttpAdapter implements RpcTransport {
  private id = 0;
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 10000,
    private readonly retries = 1,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async request(method: string, params: unknown[] = []): Promise<unknown> {
    if (!/^eth_(chainId|blockNumber|getCode|getBalance|call)$/.test(method))
      throw new RpcError('RPC method is not allowlisted');
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetcher(this.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
          signal: controller.signal,
        });
        if (!response.ok) throw new RpcError(`RPC HTTP ${response.status}`);
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object') throw new RpcError('Malformed RPC response');
        const record = body as Record<string, unknown>;
        if (record.error) throw new RpcError('RPC returned an error');
        if (!('result' in record)) throw new RpcError('RPC missing result');
        return record.result;
      } catch (e) {
        if (attempt === this.retries)
          throw new RpcError(`RPC unavailable: ${e instanceof Error ? e.name : 'unknown error'}`);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new RpcError('RPC retry exhausted');
  }
}
export class FailoverRpcAdapter implements RpcTransport {
  private cursor = 0;
  constructor(private readonly providers: readonly RpcTransport[]) {
    if (providers.length === 0) throw new RpcError('At least one RPC provider is required');
  }
  async request(method: string, params: unknown[] = []): Promise<unknown> {
    let lastError: unknown;
    for (let offset = 0; offset < this.providers.length; offset++) {
      const index = (this.cursor + offset) % this.providers.length;
      try {
        const result = await this.providers[index]!.request(method, params);
        this.cursor = index;
        return result;
      } catch (error) {
        lastError = error;
      }
    }
    throw new RpcError(
      `All RPC providers unavailable: ${lastError instanceof Error ? lastError.name : 'unknown'}`,
    );
  }
}
function hexBigInt(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value))
    throw new RpcError('Invalid RPC hex quantity');
  return BigInt(value);
}
export class SepoliaReadAdapter implements ChainStatePort {
  constructor(
    private readonly rpc: RpcTransport,
    private readonly confirmations: number,
    private readonly expectedChainId: 11155111,
  ) {}
  async verifyNetwork(): Promise<void> {
    const id = hexBigInt(await this.rpc.request('eth_chainId'));
    if (id !== BigInt(this.expectedChainId))
      throw new RpcError(`RPC chain mismatch: expected chain ${this.expectedChainId}`);
  }
  async latestBlock(): Promise<bigint> {
    return hexBigInt(await this.rpc.request('eth_blockNumber'));
  }
  async finalizedBlock(chainId: 11155111): Promise<bigint> {
    if (chainId !== this.expectedChainId) throw new RpcError('Unsupported chain');
    const latest = await this.latestBlock();
    return latest > BigInt(this.confirmations) ? latest - BigInt(this.confirmations) : 0n;
  }
  async contractCode(address: Address): Promise<`0x${string}`> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new RpcError('Invalid address');
    const result = await this.rpc.request('eth_getCode', [address, 'latest']);
    if (typeof result !== 'string' || !/^0x(?:[a-fA-F0-9]{2})*$/.test(result))
      throw new RpcError('Invalid bytecode response');
    return result as `0x${string}`;
  }
  async inspect(address: Address): Promise<{ address: Address; deployed: boolean; bytecodeLength: number }> {
    const code = await this.contractCode(address);
    return { address, deployed: code.length > 2, bytecodeLength: (code.length - 2) / 2 };
  }
}
