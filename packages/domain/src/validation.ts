import { DomainError } from './errors.js';
import type { Address, ChainId } from './types.js';
export function parseAddress(value: string): Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new DomainError('INVALID_INPUT', 'Invalid EVM address');
  return value as Address;
}
export function parseChainId(value: number): ChainId {
  if (value !== 1 && value !== 11155111) throw new DomainError('INVALID_INPUT', 'Unsupported chain');
  return value;
}
export function assertPositiveAmount(amount: bigint): void {
  if (amount <= 0n) throw new DomainError('INVALID_INPUT', 'Amount must be positive');
}
export function assertStrategyShape(strategy: 'NormalLP' | 'BuyDip' | 'SellPump', shapeId: number): void {
  if (!Number.isSafeInteger(shapeId) || shapeId < 0) throw new DomainError('INVALID_INPUT', 'Invalid shape');
  if ((strategy === 'BuyDip' || strategy === 'SellPump') && ![3, 4, 7].includes(shapeId)) {
    throw new DomainError('UNSUPPORTED_FEATURE', 'Shape is not supported by the selected strategy');
  }
}
