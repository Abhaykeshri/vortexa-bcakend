import type {
  PinnedVaultState,
  PinnedWalletPosition,
  ProjectionState,
  VaultProjection,
  WalletVaultPosition,
} from '../../domain/src/types.js';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export interface M7ParityResult {
  readonly passed: boolean;
  readonly pinnedBlock: string;
  readonly mismatches: readonly string[];
}

export interface M7FinalizedSnapshotProof {
  readonly passed: boolean;
  readonly snapshotBlock: string;
  readonly finalizedHead: string | null;
  readonly mismatches: readonly string[];
}

export function proveFinalizedProjectionSnapshot(
  state: ProjectionState,
  finalizedHead: bigint | undefined,
  canonicalBlockHash: `0x${string}`,
): M7FinalizedSnapshotProof {
  const mismatches: string[] = [];
  if (finalizedHead === undefined) mismatches.push('FINALIZED_HEAD_UNAVAILABLE');
  else if (state.indexedThroughBlock > finalizedHead) mismatches.push('SNAPSHOT_NOT_FINALIZED');
  if (state.indexedBlockHash.toLowerCase() !== canonicalBlockHash.toLowerCase())
    mismatches.push('CANONICAL_BLOCK_HASH');
  return {
    passed: mismatches.length === 0,
    snapshotBlock: state.indexedThroughBlock.toString(),
    finalizedHead: finalizedHead?.toString() ?? null,
    mismatches,
  };
}

export function hasPositiveHolderSample(positions: readonly WalletVaultPosition[]): boolean {
  return positions.some((position) => position.shares > 0n);
}

export function reconcileVaultAtPinnedBlock(
  projection: VaultProjection,
  pinned: PinnedVaultState,
  finalizedSnapshotProven = false,
): M7ParityResult {
  const mismatches: string[] = [];
  if (projection.address.toLowerCase() !== pinned.vaultAddress.toLowerCase())
    mismatches.push('VAULT_IDENTITY');
  if (projection.indexedThroughBlock !== pinned.blockNumber) mismatches.push('INDEXED_BLOCK');
  if (projection.indexedBlockHash.toLowerCase() !== pinned.blockHash.toLowerCase())
    mismatches.push('CANONICAL_BLOCK_HASH');
  if (projection.strategyContract.toLowerCase() !== pinned.strategyContract.toLowerCase())
    mismatches.push('STRATEGY');
  if (stable(projection.config) !== stable(pinned.config)) mismatches.push('CONFIG');
  if (projection.totalShares !== pinned.totalShares) mismatches.push('SHARE_SUPPLY');
  if (projection.totalAssets !== pinned.totalAssets) mismatches.push('TOTAL_ASSETS');
  if (projection.totalAssets0 !== pinned.totalAssets0) mismatches.push('TOKEN0_BALANCE');
  if (projection.totalAssets1 !== pinned.totalAssets1) mismatches.push('TOKEN1_BALANCE');
  if (projection.accountingAvailable !== pinned.accountingAvailable)
    mismatches.push('ACCOUNTING_AVAILABILITY');
  if (!finalizedSnapshotProven && projection.finality !== 'FINALIZED') mismatches.push('FINALITY');
  return { passed: mismatches.length === 0, pinnedBlock: pinned.blockNumber.toString(), mismatches };
}

export function reconcilePositionAtPinnedBlock(
  projection: WalletVaultPosition,
  pinned: PinnedWalletPosition,
  finalizedSnapshotProven = false,
): M7ParityResult {
  const mismatches: string[] = [];
  if (projection.vaultAddress.toLowerCase() !== pinned.vaultAddress.toLowerCase())
    mismatches.push('VAULT_IDENTITY');
  if (projection.walletAddress.toLowerCase() !== pinned.walletAddress.toLowerCase())
    mismatches.push('WALLET_IDENTITY');
  if (projection.asOfBlock !== pinned.blockNumber) mismatches.push('INDEXED_BLOCK');
  if (projection.shares !== pinned.shares) mismatches.push('HOLDER_SHARES');
  if (projection.amount0 !== pinned.amount0) mismatches.push('TOKEN0_EXPOSURE');
  if (projection.amount1 !== pinned.amount1) mismatches.push('TOKEN1_EXPOSURE');
  if (projection.accountingAvailable !== pinned.accountingAvailable)
    mismatches.push('ACCOUNTING_AVAILABILITY');
  if (!finalizedSnapshotProven && projection.finality !== 'FINALIZED') mismatches.push('FINALITY');
  return { passed: mismatches.length === 0, pinnedBlock: pinned.blockNumber.toString(), mismatches };
}

export function reconcilePositiveHolderAtPinnedBlock(
  projection: WalletVaultPosition,
  pinned: PinnedWalletPosition,
  finalizedSnapshotProven = false,
): M7ParityResult {
  const result = reconcilePositionAtPinnedBlock(projection, pinned, finalizedSnapshotProven);
  const mismatches = [...result.mismatches];
  if (projection.shares <= 0n || pinned.shares <= 0n) mismatches.push('POSITIVE_HOLDER_BALANCE');
  return { ...result, passed: mismatches.length === 0, mismatches };
}
