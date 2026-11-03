import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GetVault,
  GetCapabilities,
  PreparePairDeposit,
  RequireFeature,
} from '../packages/application/src/use-cases.js';
import {
  InMemoryVaultAdapter,
  StaticCapabilityAdapter,
  MockSimulator,
  InMemoryAudit,
} from '../packages/adapters/src/in-memory.js';
const addr = `0x${'1'.repeat(40)}` as const;
test('vault lookup and isolation', async () => {
  const repo = new InMemoryVaultAdapter();
  await repo.save({
    chainId: 11155111,
    address: addr,
    strategy: 'NormalLP',
    shapeId: 3,
    ownerRole: 'GOVERNANCE_ONLY',
    asOfBlock: 100n,
  });
  const get = new GetVault(repo);
  assert.equal((await get.execute(11155111, addr)).shapeId, 3);
  await assert.rejects(() => get.execute(1, addr), { code: 'NOT_FOUND' });
});
test('missing contract features fail closed', async () => {
  const port = new StaticCapabilityAdapter();
  const get = new GetCapabilities(port);
  assert.equal(
    (await get.execute(11155111, ['vault.userRebalance']))['vault.userRebalance'],
    'PENDING_CONTRACT',
  );
  await assert.rejects(() => new RequireFeature(port).execute(11155111, 'vault.userRebalance'), {
    code: 'CONTRACT_PENDING',
  });
});
test('deposit intent requires verified capability and simulation', async () => {
  const audit = new InMemoryAudit();
  const caps = new StaticCapabilityAdapter({ 'vault.depositPair': 'SUPPORTED' });
  const uc = new PreparePairDeposit(caps, new MockSimulator(), audit);
  const intent = await uc.execute({
    chainId: 11155111,
    vault: addr,
    amount0: 100n,
    amount1: 0n,
    encodedData: '0x12345678',
    pinnedBlock: 123n,
  });
  assert.equal(intent.value, 0n);
  assert.equal(audit.events.length, 1);
  await assert.rejects(
    () =>
      uc.execute({
        chainId: 11155111,
        vault: addr,
        amount0: -1n,
        amount1: 0n,
        encodedData: '0x12345678',
        pinnedBlock: 123n,
      }),
    { code: 'INVALID_INPUT' },
  );
});
test('reverted simulation cannot create usable intent', async () => {
  const uc = new PreparePairDeposit(
    new StaticCapabilityAdapter({ 'vault.depositPair': 'SUPPORTED' }),
    new MockSimulator(false),
    new InMemoryAudit(),
  );
  await assert.rejects(
    () =>
      uc.execute({
        chainId: 11155111,
        vault: addr,
        amount0: 1n,
        amount1: 0n,
        encodedData: '0x12345678',
        pinnedBlock: 1n,
      }),
    { code: 'STALE_STATE' },
  );
});
