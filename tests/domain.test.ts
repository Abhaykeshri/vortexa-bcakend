import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAddress,
  parseChainId,
  assertPositiveAmount,
  assertStrategyShape,
} from '../packages/domain/src/validation.js';
import { DomainError } from '../packages/domain/src/errors.js';
import { formatTokenAmount } from '../packages/domain/src/vault-ui.js';
const addr = `0x${'1'.repeat(40)}` as const;
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
test('token display formatting supports assets with fewer than eight decimals', () => {
  assert.equal(formatTokenAmount(19_999_497n, 6), '19.999497');
  assert.equal(formatTokenAmount(7_110_960_961_479_480n, 18), '0.00711096');
  assert.equal(formatTokenAmount(500n, 6), '0.0005');
});
