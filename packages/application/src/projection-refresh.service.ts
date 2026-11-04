import type {
  PinnedProjectionWriterPort,
  PinnedVaultStateReaderPort,
  VaultCatalogRepositoryPort,
} from '../../domain/src/ports.js';
import type {
  ChainId,
  PinnedVaultState,
  PinnedWalletPosition,
  VaultListCursor,
  VaultProjection,
} from '../../domain/src/types.js';

/**
 * Refreshes vault accounting and holder exposure from one pinned canonical block.
 * The projection head and block hash are checked before committing the complete snapshot.
 */
export class ProjectionRefreshService {
  constructor(
    private readonly chainId: ChainId,
    private readonly repository: VaultCatalogRepositoryPort,
    private readonly reader: PinnedVaultStateReaderPort,
    private readonly writer: PinnedProjectionWriterPort,
  ) {}

  /**
   * Reads all projected vaults and holders at `blockNumber`, then atomically saves the snapshot.
   * @returns Counts of refreshed vaults and wallet positions.
   */
  async refreshAt(blockNumber: bigint): Promise<{ vaults: number; positions: number }> {
    const state = await this.repository.projectionState(this.chainId);
    if (!state || state.indexedThroughBlock !== blockNumber)
      throw new Error('Vault projection head changed before pinned refresh');
    const vaults: VaultProjection[] = [];
    let cursor: VaultListCursor | null = null;
    do {
      const page = await this.repository.listVaults(this.chainId, blockNumber, cursor, 100);
      vaults.push(...page);
      const last = page.at(-1);
      cursor =
        page.length === 100 && last ? { creationBlock: last.creationBlock, address: last.address } : null;
    } while (cursor);
    const pinnedVaults: PinnedVaultState[] = [];
    const pinnedPositions: PinnedWalletPosition[] = [];
    for (const vault of vaults) {
      const pinned = await this.reader.vaultState(this.chainId, vault.address, blockNumber);
      if (pinned.blockHash.toLowerCase() !== state.indexedBlockHash.toLowerCase())
        throw new Error('Vault projection pinned block hash mismatch');
      pinnedVaults.push(pinned);
      const holders = await this.repository.listVaultHolders(this.chainId, vault.address);
      for (const holder of holders)
        pinnedPositions.push(
          await this.reader.walletPosition(this.chainId, vault.address, holder.walletAddress, blockNumber),
        );
    }
    await this.writer.savePinnedSnapshot({
      chainId: this.chainId,
      blockNumber,
      blockHash: state.indexedBlockHash,
      finality: state.finality,
      vaults: pinnedVaults,
      positions: pinnedPositions,
    });
    return { vaults: pinnedVaults.length, positions: pinnedPositions.length };
  }
}
