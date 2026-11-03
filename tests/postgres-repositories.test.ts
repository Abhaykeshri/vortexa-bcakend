import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresVaultRepository } from '../packages/adapters/src/postgres/repositories.js';
const addr = '0x145bf19548AbcDd5a0355596de00E4d8992a6B60' as const;
test('Postgres repository parameterizes writes and preserves bigint', async () => {
  const calls: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  const db = {
    query: async (text: string, values?: readonly unknown[]) => {
      calls.push({ text, values });
      return { rows: [], rowCount: 1 };
    },
  };
  await new PostgresVaultRepository(db).save({
    chainId: 11155111,
    address: addr,
    strategy: 'NormalLP',
    shapeId: 3,
    ownerRole: 'GOVERNANCE_ONLY',
    asOfBlock: 2n ** 100n,
  });
  assert.match(calls[0]!.text, /\$1/);
  assert.equal(calls[0]!.values?.[5], (2n ** 100n).toString());
  assert.equal(calls[0]!.text.includes(addr), false);
});
test('Postgres repository maps numeric quantities back to bigint', async () => {
  const db = {
    query: async () => ({
      rows: [
        {
          chain_id: '11155111',
          address: addr.toLowerCase(),
          strategy: 'NormalLP',
          shape_id: 3,
          owner_role: 'GOVERNANCE_ONLY',
          as_of_block: '123456789012345678901',
        },
      ],
      rowCount: 1,
    }),
  };
  const result = await new PostgresVaultRepository(db).find(11155111, addr);
  assert.equal(result?.asOfBlock, 123456789012345678901n);
});
