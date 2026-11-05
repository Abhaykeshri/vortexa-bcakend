import type { Pool } from 'pg';
import { and, asc, desc, eq, gt, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PinnedProjectionWriterPort, VaultCatalogRepositoryPort } from '../../../domain/src/ports.js';
import type {
  Address,
  ChainId,
  PositionListCursor,
  ProjectionFinality,
  ProjectionState,
  VaultEventCursor,
  VaultListCursor,
  VaultProjection,
  VaultProjectionEvent,
  WalletVaultPosition,
} from '../../../domain/src/types.js';
import * as schema from './schema.js';

function finality(value: string): ProjectionFinality {
  if (value !== 'OBSERVED' && value !== 'CONFIRMED' && value !== 'FINALIZED')
    throw new Error('Invalid projection finality');
  return value;
}

function requiredAddress(value: string | null, field: string): Address {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`Invalid vault projection ${field}`);
  return value.toLowerCase() as Address;
}

function requiredHash(value: string | null, field: string): `0x${string}` {
  if (!value || !/^0x[a-fA-F0-9]{64}$/.test(value)) throw new Error(`Invalid vault projection ${field}`);
  return value.toLowerCase() as `0x${string}`;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

type VaultRow = typeof schema.vaults.$inferSelect;

function mapVault(row: VaultRow): VaultProjection {
  if (
    row.creationBlock === null ||
    row.creationTransactionHash === null ||
    row.poolId === null ||
    row.indexedThroughBlock === null
  )
    throw new Error('Incomplete vault projection vault projection');
  if (!['NormalLP', 'BuyDip', 'SellPump'].includes(row.strategy))
    throw new Error('Invalid vault projection vault strategy');
  return {
    chainId: row.chainId as ChainId,
    address: requiredAddress(row.address, 'vault address'),
    factoryAddress: requiredAddress(row.factoryAddress, 'factory address'),
    creator: requiredAddress(row.creator, 'creator'),
    creationTransactionHash: requiredHash(row.creationTransactionHash, 'creation transaction hash'),
    creationBlock: BigInt(row.creationBlock),
    poolId: requiredHash(row.poolId, 'pool id'),
    strategy: row.strategy as VaultProjection['strategy'],
    strategyContract: requiredAddress(row.strategyContract, 'strategy contract'),
    shapeId: row.shapeId,
    name: row.name,
    symbol: row.symbol,
    manager: row.manager === null ? null : requiredAddress(row.manager, 'manager'),
    paused: row.paused,
    inRange: row.inRange,
    poolTick: row.poolTick,
    config: record(row.config),
    totalShares: BigInt(row.totalShares),
    totalAssets: row.totalAssets === null ? null : BigInt(row.totalAssets),
    totalAssets0: row.totalAssets0 === null ? null : BigInt(row.totalAssets0),
    totalAssets1: row.totalAssets1 === null ? null : BigInt(row.totalAssets1),
    accountingAvailable: row.accountingAvailable,
    finality: finality(row.finality),
    indexedThroughBlock: BigInt(row.indexedThroughBlock),
    indexedBlockHash: requiredHash(row.indexedBlockHash, 'indexed block hash'),
  };
}

/**
 * Drizzle-backed adapter for vault catalog reads and atomic pinned projection writes.
 * All blockchain quantities are mapped to bigint at the port boundary.
 */
export class DrizzleVaultProjectionRepository
  implements VaultCatalogRepositoryPort, PinnedProjectionWriterPort
{
  private readonly db: NodePgDatabase<typeof schema>;

  constructor(pool: Pool) {
    this.db = drizzle(pool, { schema });
  }

  async projectionState(chainId: ChainId): Promise<ProjectionState | null> {
    const [row] = await this.db
      .select()
      .from(schema.projectionState)
      .where(eq(schema.projectionState.chainId, chainId))
      .limit(1);
    return row
      ? {
          chainId: row.chainId as ChainId,
          generation: row.generation,
          indexedThroughBlock: BigInt(row.indexedThroughBlock),
          indexedBlockHash: requiredHash(row.indexedBlockHash, 'projection state block hash'),
          finality: finality(row.finality),
        }
      : null;
  }

  async listVaults(
    chainId: ChainId,
    snapshotBlock: bigint,
    cursor: VaultListCursor | null,
    limit: number,
  ): Promise<readonly VaultProjection[]> {
    const cursorFilter = cursor
      ? or(
          lt(schema.vaults.creationBlock, cursor.creationBlock.toString()),
          and(
            eq(schema.vaults.creationBlock, cursor.creationBlock.toString()),
            gt(schema.vaults.address, cursor.address.toLowerCase()),
          ),
        )
      : undefined;
    const rows = await this.db
      .select()
      .from(schema.vaults)
      .where(
        and(
          eq(schema.vaults.chainId, chainId),
          isNotNull(schema.vaults.factoryAddress),
          isNotNull(schema.vaults.creationBlock),
          lte(schema.vaults.creationBlock, snapshotBlock.toString()),
          cursorFilter,
        ),
      )
      .orderBy(desc(schema.vaults.creationBlock), asc(schema.vaults.address))
      .limit(limit);
    return rows.map(mapVault);
  }

  async findVault(chainId: ChainId, address: Address): Promise<VaultProjection | null> {
    const [row] = await this.db
      .select()
      .from(schema.vaults)
      .where(
        and(
          eq(schema.vaults.chainId, chainId),
          eq(schema.vaults.address, address.toLowerCase()),
          isNotNull(schema.vaults.factoryAddress),
        ),
      )
      .limit(1);
    return row ? mapVault(row) : null;
  }

  async listVaultEvents(
    chainId: ChainId,
    vault: Address,
    snapshotBlock: bigint,
    cursor: VaultEventCursor | null,
    limit: number,
  ): Promise<readonly VaultProjectionEvent[]> {
    const cursorFilter = cursor
      ? or(
          lt(schema.rawLogs.blockNumber, cursor.blockNumber.toString()),
          and(
            eq(schema.rawLogs.blockNumber, cursor.blockNumber.toString()),
            lt(schema.rawLogs.transactionIndex, cursor.transactionIndex),
          ),
          and(
            eq(schema.rawLogs.blockNumber, cursor.blockNumber.toString()),
            eq(schema.rawLogs.transactionIndex, cursor.transactionIndex),
            lt(schema.rawLogs.logIndex, cursor.logIndex),
          ),
        )
      : undefined;
    const rows = await this.db
      .select()
      .from(schema.rawLogs)
      .where(
        and(
          eq(schema.rawLogs.chainId, chainId),
          eq(schema.rawLogs.address, vault.toLowerCase()),
          eq(schema.rawLogs.canonical, true),
          isNotNull(schema.rawLogs.eventName),
          lte(schema.rawLogs.blockNumber, snapshotBlock.toString()),
          cursorFilter,
        ),
      )
      .orderBy(
        desc(schema.rawLogs.blockNumber),
        desc(schema.rawLogs.transactionIndex),
        desc(schema.rawLogs.logIndex),
      )
      .limit(limit);
    return rows.map((row) => ({
      chainId: row.chainId as ChainId,
      blockNumber: BigInt(row.blockNumber),
      blockHash: requiredHash(row.blockHash, 'event block hash'),
      transactionHash: requiredHash(row.transactionHash, 'event transaction hash'),
      transactionIndex: row.transactionIndex,
      logIndex: row.logIndex,
      address: requiredAddress(row.address, 'event address'),
      eventName: row.eventName!,
      eventArgs: record(row.eventArgs),
      finality: finality(row.finality),
    }));
  }

  async listWalletPositions(
    chainId: ChainId,
    wallet: Address,
    snapshotBlock: bigint,
    cursor: PositionListCursor | null,
    limit: number,
  ): Promise<readonly WalletVaultPosition[]> {
    const rows = await this.db
      .select()
      .from(schema.balances)
      .where(
        and(
          eq(schema.balances.chainId, chainId),
          eq(schema.balances.walletAddress, wallet.toLowerCase()),
          gt(schema.balances.shares, '0'),
          lte(schema.balances.asOfBlock, snapshotBlock.toString()),
          cursor ? gt(schema.balances.vaultAddress, cursor.vaultAddress.toLowerCase()) : undefined,
        ),
      )
      .orderBy(asc(schema.balances.vaultAddress))
      .limit(limit);
    return rows.map((row) => ({
      chainId: row.chainId as ChainId,
      vaultAddress: requiredAddress(row.vaultAddress, 'position vault'),
      walletAddress: requiredAddress(row.walletAddress, 'position wallet'),
      shares: BigInt(row.shares),
      amount0: row.amount0 === null ? null : BigInt(row.amount0),
      amount1: row.amount1 === null ? null : BigInt(row.amount1),
      accountingAvailable: row.accountingAvailable,
      finality: finality(row.finality),
      asOfBlock: BigInt(row.asOfBlock),
      indexedBlockHash: requiredHash(row.indexedBlockHash, 'position indexed block hash'),
    }));
  }

  async listVaultHolders(chainId: ChainId, vault: Address): Promise<readonly WalletVaultPosition[]> {
    const rows = await this.db
      .select()
      .from(schema.balances)
      .where(
        and(
          eq(schema.balances.chainId, chainId),
          eq(schema.balances.vaultAddress, vault.toLowerCase()),
          gt(schema.balances.shares, '0'),
        ),
      )
      .orderBy(asc(schema.balances.walletAddress));
    return rows.map((row) => ({
      chainId: row.chainId as ChainId,
      vaultAddress: requiredAddress(row.vaultAddress, 'holder vault'),
      walletAddress: requiredAddress(row.walletAddress, 'holder wallet'),
      shares: BigInt(row.shares),
      amount0: row.amount0 === null ? null : BigInt(row.amount0),
      amount1: row.amount1 === null ? null : BigInt(row.amount1),
      accountingAvailable: row.accountingAvailable,
      finality: finality(row.finality),
      asOfBlock: BigInt(row.asOfBlock),
      indexedBlockHash: requiredHash(row.indexedBlockHash, 'holder indexed block hash'),
    }));
  }

  async savePinnedSnapshot(input: Parameters<PinnedProjectionWriterPort['savePinnedSnapshot']>[0]) {
    await this.db.transaction(async (transaction) => {
      for (const pinned of input.vaults) {
        const rawShape = pinned.config.shapeId;
        const shapeId =
          typeof rawShape === 'number'
            ? rawShape
            : typeof rawShape === 'string' && /^[0-9]+$/.test(rawShape)
              ? Number(rawShape)
              : null;
        const result = await transaction
          .update(schema.vaults)
          .set({
            strategyContract: pinned.strategyContract,
            shapeId,
            name: pinned.name ?? null,
            symbol: pinned.symbol ?? null,
            manager: pinned.manager ?? null,
            paused: pinned.paused ?? null,
            inRange: pinned.inRange ?? null,
            poolTick: pinned.poolTick ?? null,
            config: pinned.config,
            totalShares: pinned.totalShares.toString(),
            totalAssets: pinned.totalAssets.toString(),
            totalAssets0: pinned.totalAssets0?.toString() ?? null,
            totalAssets1: pinned.totalAssets1?.toString() ?? null,
            accountingAvailable: pinned.accountingAvailable,
            finality: input.finality,
            asOfBlock: input.blockNumber.toString(),
            indexedThroughBlock: input.blockNumber.toString(),
            indexedBlockHash: input.blockHash,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.vaults.chainId, input.chainId),
              eq(schema.vaults.address, pinned.vaultAddress.toLowerCase()),
              isNotNull(schema.vaults.factoryAddress),
            ),
          )
          .returning({ address: schema.vaults.address });
        if (result.length !== 1) throw new Error('Pinned vault projection target missing');
      }
      for (const pinned of input.positions) {
        const result = await transaction
          .update(schema.balances)
          .set({
            shares: pinned.shares.toString(),
            amount0: pinned.amount0?.toString() ?? null,
            amount1: pinned.amount1?.toString() ?? null,
            accountingAvailable: pinned.accountingAvailable,
            finality: input.finality,
            asOfBlock: input.blockNumber.toString(),
            indexedBlockHash: input.blockHash,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.balances.chainId, input.chainId),
              eq(schema.balances.vaultAddress, pinned.vaultAddress.toLowerCase()),
              eq(schema.balances.walletAddress, pinned.walletAddress.toLowerCase()),
            ),
          )
          .returning({ wallet: schema.balances.walletAddress });
        if (result.length !== 1) throw new Error('Pinned holder projection target missing');
      }
      if (input.vaults.length || input.positions.length)
        await transaction
          .update(schema.projectionState)
          .set({ generation: sql`${schema.projectionState.generation} + 1`, updatedAt: new Date() })
          .where(eq(schema.projectionState.chainId, input.chainId));
    });
  }
}
