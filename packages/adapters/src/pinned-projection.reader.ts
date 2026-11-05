import type { PinnedVaultStateReaderPort } from '../../domain/src/ports.js';
import type { Address, ChainId, PinnedVaultState, PinnedWalletPosition } from '../../domain/src/types.js';
import { ContractReader } from './contract-reader.adapter.js';

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function bigint(value: unknown, label: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value);
  throw new Error(`Invalid ${label}`);
}

function address(value: unknown, label: string): Address {
  if (typeof value !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value.toLowerCase() as Address;
}

function nullableBigint(value: unknown): bigint | null {
  return value === undefined || value === null ? null : bigint(value, 'optional quantity');
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) throw new Error(`Invalid ${label}`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}

export class ViemPinnedVaultStateReader implements PinnedVaultStateReaderPort {
  private readonly reader: ContractReader;

  constructor(
    rpcUrls: readonly string[],
    private readonly expectedChainId: ChainId,
    private readonly lensAddress: Address,
  ) {
    this.reader = new ContractReader(rpcUrls, expectedChainId);
  }

  async vaultState(chainId: ChainId, vault: Address, blockNumber: bigint): Promise<PinnedVaultState> {
    if (chainId !== this.expectedChainId) throw new Error('Unsupported pinned-read chain');
    const [rawInfo, rawStrategy, blockHash] = await Promise.all([
      this.reader.read('VaultLens', this.lensAddress, 'vaultInfo', [vault], blockNumber),
      this.reader.read('Vault', vault, 'strategy', [], blockNumber),
      this.reader.blockHash(blockNumber),
    ]);
    const info = object(rawInfo, 'VaultLens vaultInfo');
    const config = object(info.config, 'vault config');
    const accountingAvailable = info.accountingAvailable === true;
    return {
      vaultAddress: vault.toLowerCase() as Address,
      blockNumber,
      blockHash,
      strategyContract: address(rawStrategy, 'vault strategy'),
      config: jsonSafe(config) as Readonly<Record<string, unknown>>,
      totalShares: bigint(info.totalShares, 'total shares'),
      totalAssets: bigint(info.totalAssets, 'total assets'),
      totalAssets0: accountingAvailable ? nullableBigint(info.totalAssets0) : null,
      totalAssets1: accountingAvailable ? nullableBigint(info.totalAssets1) : null,
      accountingAvailable,
      name: text(info.name, 'vault name'),
      symbol: text(info.symbol, 'vault symbol'),
      manager: address(info.manager, 'vault manager'),
      paused: info.paused === true,
      inRange: info.inRange === true,
      poolTick: integer(info.poolTick, 'pool tick'),
    };
  }

  async walletPosition(
    chainId: ChainId,
    vault: Address,
    wallet: Address,
    blockNumber: bigint,
  ): Promise<PinnedWalletPosition> {
    if (chainId !== this.expectedChainId) throw new Error('Unsupported pinned-read chain');
    const raw = await this.reader.read(
      'VaultLens',
      this.lensAddress,
      'userPosition',
      [vault, wallet],
      blockNumber,
    );
    const position = object(raw, 'VaultLens userPosition');
    const accountingAvailable = position.accountingAvailable === true;
    return {
      vaultAddress: vault.toLowerCase() as Address,
      walletAddress: wallet.toLowerCase() as Address,
      blockNumber,
      shares: bigint(position.shares, 'holder shares'),
      amount0: accountingAvailable ? nullableBigint(position.amount0) : null,
      amount1: accountingAvailable ? nullableBigint(position.amount1) : null,
      accountingAvailable,
    };
  }
}
