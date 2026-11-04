import pg from 'pg';
import { loadConfig } from '../dist/apps/api/src/config/env.js';
import { ContractReader } from '../dist/packages/adapters/src/contract-reader.adapter.js';
import { ViemPinnedVaultStateReader } from '../dist/packages/adapters/src/pinned-projection.reader.js';
import { DrizzleVaultProjectionRepository } from '../dist/packages/adapters/src/postgres/vault-projection.repository.js';
import {
  AbiEventDecoder,
  ViemIndexerSource,
} from '../dist/packages/adapters/src/indexer/viem-indexer-source.adapter.js';
import {
  hasPositiveHolderSample,
  proveFinalizedProjectionSnapshot,
  reconcilePositiveHolderAtPinnedBlock,
  reconcileVaultAtPinnedBlock,
} from '../dist/packages/application/src/projection-reconciliation.service.js';

const { Pool } = pg;
const config = loadConfig(undefined, undefined, 'tool');
const reader = new ContractReader(config.rpcUrls, config.chainId);
const blockers = [];
let factoryVaultCount = null;

try {
  const rawCount = await reader.read('VaultFactory', config.contracts.VAULT_FACTORY, 'vaultCount');
  factoryVaultCount = BigInt(rawCount).toString();
  if (BigInt(rawCount) === 0n) blockers.push('NO_FACTORY_VAULT_SAMPLE');
} catch {
  blockers.push('FACTORY_READ_UNAVAILABLE');
}

if (!config.databaseUrl) blockers.push('DATABASE_URL_MISSING');

let pool;
let projectionState = null;
let finalizedSnapshotProof = null;
let vaultParity = null;
let holderParity = [];
try {
  if (config.databaseUrl) {
    pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
    const relation = await pool.query("SELECT to_regclass('m7_projection_state') AS name");
    if (!relation.rows[0]?.name) {
      blockers.push('VAULT_PROJECTION_MIGRATION_NOT_APPLIED');
      throw Object.assign(new Error('Vault projection schema is absent'), { expectedBlocker: true });
    }
    const repository = new DrizzleVaultProjectionRepository(pool);
    const state = await repository.projectionState(config.chainId);
    projectionState = state
      ? {
          indexedThroughBlock: state.indexedThroughBlock.toString(),
          finality: state.finality,
          generation: state.generation.toString(),
        }
      : null;
    if (!state) blockers.push('PROJECTION_STATE_MISSING');

    let finalizedSnapshotProven = false;
    if (state) {
      try {
        const source = new ViemIndexerSource(
          config.chainId,
          config.rpcUrls,
          new AbiEventDecoder(config.contracts, config.manifest),
          config.indexerConfirmations,
        );
        await source.verifyChain(config.chainId);
        const [heads, canonicalBlockHash] = await Promise.all([
          source.heads(),
          reader.blockHash(state.indexedThroughBlock),
        ]);
        finalizedSnapshotProof = proveFinalizedProjectionSnapshot(state, heads.finalized, canonicalBlockHash);
        finalizedSnapshotProven = finalizedSnapshotProof.passed;
        if (finalizedSnapshotProof.mismatches.includes('FINALIZED_HEAD_UNAVAILABLE'))
          blockers.push('FINALIZED_HEAD_UNAVAILABLE');
        if (finalizedSnapshotProof.mismatches.includes('SNAPSHOT_NOT_FINALIZED'))
          blockers.push('FINALIZED_PROJECTION_PENDING');
        if (finalizedSnapshotProof.mismatches.includes('CANONICAL_BLOCK_HASH'))
          blockers.push('PROJECTION_CANONICAL_HASH_MISMATCH');
      } catch {
        blockers.push('FINALIZED_SNAPSHOT_PROOF_UNAVAILABLE');
      }
    }

    const vaults = state
      ? await repository.listVaults(config.chainId, state.indexedThroughBlock, null, 1)
      : [];
    const vault = vaults[0];
    if (!vault) {
      blockers.push('FINALIZED_VAULT_SAMPLE_MISSING');
    } else if (state && finalizedSnapshotProven) {
      const pinnedReader = new ViemPinnedVaultStateReader(
        config.rpcUrls,
        config.chainId,
        config.contracts.VAULT_LENS,
      );
      const pinnedVault = await pinnedReader.vaultState(
        config.chainId,
        vault.address,
        state.indexedThroughBlock,
      );
      vaultParity = reconcileVaultAtPinnedBlock(vault, pinnedVault, true);
      if (!vaultParity.passed) blockers.push('VAULT_PINNED_PARITY_FAILED');

      const holders = await repository.listVaultHolders(config.chainId, vault.address);
      if (!hasPositiveHolderSample(holders)) blockers.push('FINALIZED_POSITIVE_HOLDER_SAMPLE_MISSING');
      for (const holder of holders.filter((candidate) => candidate.shares > 0n)) {
        const pinned = await pinnedReader.walletPosition(
          config.chainId,
          vault.address,
          holder.walletAddress,
          state.indexedThroughBlock,
        );
        const parity = reconcilePositiveHolderAtPinnedBlock(holder, pinned, true);
        holderParity.push({ wallet: holder.walletAddress, ...parity });
        if (!parity.passed) blockers.push('HOLDER_PINNED_PARITY_FAILED');
      }
    }
  }
} catch (error) {
  const expectedBlocker =
    error && typeof error === 'object' && 'expectedBlocker' in error && error.expectedBlocker === true;
  if (!expectedBlocker) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    blockers.push(
      code === '42P01' || code === '42703'
        ? 'VAULT_PROJECTION_MIGRATION_NOT_APPLIED'
        : 'PROJECTION_READ_UNAVAILABLE',
    );
  }
} finally {
  await pool?.end();
}

const uniqueBlockers = [...new Set(blockers)];
const status = uniqueBlockers.length === 0 ? 'PASS' : 'BLOCKED';
console.log(
  JSON.stringify({
    status,
    readOnly: true,
    chainId: config.chainId,
    factoryVaultCount,
    projectionState,
    finalizedSnapshotProof,
    vaultParity,
    holderParity,
    blockers: uniqueBlockers,
  }),
);
if (status !== 'PASS') process.exitCode = 2;
