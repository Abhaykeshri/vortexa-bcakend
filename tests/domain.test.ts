import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAddress,
  parseChainId,
  assertPositiveAmount,
  assertStrategyShape,
} from '../packages/domain/src/validation.js';
import { DomainError } from '../packages/domain/src/errors.js';
const addr = '0x145bf19548AbcDd5a0355596de00E4d8992a6B60' as const;
test('address and chain validation', () => {
  assert.equal(parseAddress(addr), addr);
  assert.equal(parseChainId(11155111), 11155111);
  assert.throws(() => parseAddress('0x123'), DomainError);
  assert.throws(() => parseChainId(999), DomainError);
});
test('bigint exact and positive amounts', () => {
  assertPositiveAmount(2n ** 255n);
  assert.throws(() => assertPositiveAmount(0n), DomainError);
});
test('strategy shape restrictions fail closed', () => {
  assertStrategyShape('BuyDip', 3);
  assert.throws(() => assertStrategyShape('BuyDip', 1), { code: 'UNSUPPORTED_FEATURE' });
  assertStrategyShape('NormalLP', 1);
});
