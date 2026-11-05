import { DomainError } from '../../domain/src/errors.js';
import type { CachePort, VaultUiChainPort } from '../../domain/src/ports.js';
import type { Address, ChainId } from '../../domain/src/types.js';
import {
  MAX_SWAP_SLIPPAGE_BPS,
  MAX_TOLERANCE_BPS,
  MIN_AUTOMATION_FUNDING,
  SHAPE_CATALOGUE,
  STRATEGY_CATALOGUE,
  VOLATILITY_PRESETS,
  tickToDisplayPrice,
  type CreateVaultCommand,
  type DepositCommand,
  type ManagerRebalanceCommand,
  type ManagerUpdateCommand,
  type TransactionPlan,
  type VaultConfigInput,
  type WithdrawCommand,
} from '../../domain/src/vault-ui.js';
import type { VaultQueryService } from './vault-query.service.js';

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}

function serializePlan(plan: TransactionPlan): unknown {
  return jsonSafe(plan);
}

export class VaultUiService {
  constructor(
    private readonly chainId: ChainId,
    private readonly chain: VaultUiChainPort,
    private readonly projections?: VaultQueryService,
    private readonly cache?: CachePort,
  ) {}

  private assertChain(chainId: number): asserts chainId is ChainId {
    if (chainId !== this.chainId) throw new DomainError('INVALID_INPUT', 'Unsupported chain');
  }

  async pools(chainId: number): Promise<unknown> {
    this.assertChain(chainId);
    const key = `pool_catalog.chain_${chainId}.scope_public:v1.manifest:start:100`;
    const cached = await this.cache?.get<unknown>(key).catch(() => null);
    if (cached) return cached;
    const result = jsonSafe(await this.chain.listPools());
    await this.cache?.set(key, result, 30).catch(() => undefined);
    return result;
  }

  async shapes(): Promise<unknown> {
    const key = `shape_catalog.chain_${this.chainId}.scope_public:v1.contract:start:14`;
    const cached = await this.cache?.get<unknown>(key).catch(() => null);
    if (cached) return cached;
    const result = (await this.chain.listShapes()).map((shape) => {
      const metadata = SHAPE_CATALOGUE.find((item) => item.id === shape.id);
      return {
        ...shape,
        name: metadata?.name ?? null,
        nominalBandCount: metadata?.bandCount ?? null,
        allowedStrategies: STRATEGY_CATALOGUE.filter((strategy) =>
          strategy.allowedShapeIds.some((id) => id === shape.id),
        ).map((strategy) => strategy.key),
        metadataAvailable: metadata !== undefined,
      };
    });
    await this.cache?.set(key, result, 300).catch(() => undefined);
    return result;
  }

  async shapePreview(input: {
    shapeId: number;
    centerTick: number;
    ticksLeft: number;
    ticksRight: number;
    tickSpacing: number;
  }): Promise<unknown> {
    return jsonSafe(await this.chain.previewShape(input));
  }

  limits(): unknown {
    return {
      shapeId: { minimum: 0, maximum: 13 },
      maximumLimitWidthTicks: 10_000,
      maximumCarpetBps: 2_500,
      maximumSwapSlippageBps: MAX_SWAP_SLIPPAGE_BPS,
      maximumToleranceBps: MAX_TOLERANCE_BPS,
      minimumAutomationFunding: MIN_AUTOMATION_FUNDING.toString(),
      amountsEncoding: 'decimal-string',
      strategies: STRATEGY_CATALOGUE,
      volatilityPresets: VOLATILITY_PRESETS,
      volatilityPresetPolicy: 'DISPLAY_ONLY_FRONTEND_SELECTS_ALIGNED_TICKS',
    };
  }

  async validateConfig(chainId: number, config: VaultConfigInput): Promise<unknown> {
    this.assertChain(chainId);
    const result = await this.chain.validateConfig(config);
    return jsonSafe({ valid: result.violations.length === 0, ...result });
  }

  async listVaults(
    chainId: number,
    input: {
      cursor: string | null;
      limit: number;
      strategy?: string;
      poolId?: string;
      wallet?: Address;
      search?: string;
      sort?: 'age' | 'tvl' | 'apr' | 'volume';
      direction?: 'asc' | 'desc';
    },
  ): Promise<unknown> {
    this.assertChain(chainId);
    if (!this.projections) throw new DomainError('STALE_STATE', 'Projection unavailable');
    if (input.sort === 'apr' || input.sort === 'volume')
      throw new DomainError('STALE_STATE', 'Requested metric is unavailable');
    const [page, positions] = await Promise.all([
      this.projections.listVaults(chainId, input.cursor, input.limit),
      input.wallet
        ? this.projections.walletPositions(chainId, input.wallet, null, 100)
        : Promise.resolve(null),
    ]);
    const walletVaults = positions
      ? new Set(positions.data.map((position) => position.vaultAddress.toLowerCase()))
      : null;
    const search = input.search?.toLowerCase();
    let data = page.data.filter(
      (vault) =>
        (!input.strategy || vault.strategy === input.strategy) &&
        (!input.poolId || vault.poolId.toLowerCase() === input.poolId.toLowerCase()) &&
        (!walletVaults || walletVaults.has(vault.address.toLowerCase())) &&
        (!search ||
          vault.address.toLowerCase().includes(search) ||
          vault.poolId.toLowerCase().includes(search) ||
          vault.strategy.toLowerCase().includes(search) ||
          (typeof vault.name === 'string' && vault.name.toLowerCase().includes(search)) ||
          (typeof vault.symbol === 'string' && vault.symbol.toLowerCase().includes(search))),
    );
    if (input.sort === 'tvl')
      data = [...data].sort((left, right) => {
        const compared = BigInt(left.totalAssets ?? '0') - BigInt(right.totalAssets ?? '0');
        const sign = compared < 0n ? -1 : compared > 0n ? 1 : 0;
        return input.direction === 'asc' ? sign : -sign;
      });
    const availableTvl = data.map((vault) => vault.totalAssets).filter((value): value is string => value !== null);
    const groupedPairCounts = Object.entries(data.reduce<Record<string, number>>((counts, vault) => {
      counts[vault.poolId] = (counts[vault.poolId] ?? 0) + 1;
      return counts;
    }, {}));
    const knownPaused = data.filter((vault) => vault.paused !== null && vault.paused !== undefined);
    return {
      ...page,
      summary: {
        scope: 'CURRENT_PAGE',
        totalTvlRaw: availableTvl.length === data.length
          ? availableTvl.reduce((sum, value) => sum + BigInt(value), 0n).toString()
          : null,
        activeVaultCount: knownPaused.length === data.length ? data.filter((vault) => vault.paused !== true).length : null,
        volume24hUsd: null,
        averageApr: null,
        groupedPairCounts: Object.fromEntries(groupedPairCounts),
        availability: {
          totalTvlRaw: availableTvl.length === data.length ? 'AVAILABLE' : 'ACCOUNTING_UNAVAILABLE',
          activeVaultCount: knownPaused.length === data.length ? 'AVAILABLE' : 'ACTIVE_STATE_PROJECTION_UNAVAILABLE',
          volume24hUsd: 'HISTORY_UNAVAILABLE',
          averageApr: 'HISTORY_UNAVAILABLE',
        },
      },
      data: data.map((vault) => ({
        ...vault,
        metrics: {
          tvlRaw: vault.totalAssets,
          tvlUsd: null,
          apr7d: null,
          volume24hUsd: null,
          availability: {
            tvlRaw: vault.totalAssets === null ? 'UNAVAILABLE' : 'AVAILABLE',
            tvlUsd: 'PRICE_PROVIDER_UNAVAILABLE',
            apr7d: 'HISTORY_UNAVAILABLE',
            volume24hUsd: 'HISTORY_UNAVAILABLE',
          },
        },
      })),
    };
  }

  async vaultDetail(chainId: number, vault: Address, user?: Address): Promise<unknown> {
    this.assertChain(chainId);
    const [live, projected, position, walletBalances, pools] = await Promise.all([
      this.chain.vaultInfo(vault),
      this.projections?.vaultDetail(chainId, vault),
      user ? this.chain.userPosition(vault, user) : Promise.resolve(null),
      user ? this.chain.walletBalances(vault, user) : Promise.resolve(null),
      this.chain.listPools(),
    ]);
    const info = live as {
      config?: { poolKey?: { currency0?: Address; currency1?: Address; fee?: number; tickSpacing?: number; hooks?: Address } };
      protocolFeeBps?: bigint;
      poolTick?: number;
      bands?: Array<{ tickLower?: number; tickUpper?: number; tokenId?: bigint; liquidity?: bigint }>;
    };
    const key = info.config?.poolKey;
    const pool = key
      ? pools.find(
          (candidate) =>
            candidate.key.currency0.toLowerCase() === key.currency0?.toLowerCase() &&
            candidate.key.currency1.toLowerCase() === key.currency1?.toLowerCase() &&
            candidate.key.fee === key.fee &&
            candidate.key.tickSpacing === key.tickSpacing &&
            candidate.key.hooks.toLowerCase() === key.hooks?.toLowerCase(),
        ) ?? null
      : null;
    const displayPrice =
      pool && typeof info.poolTick === 'number'
        ? tickToDisplayPrice(info.poolTick, pool.token0.decimals, pool.token1.decimals)
        : null;
    const displayBands = (info.bands ?? []).map((band) => ({
      ...band,
      lowerPrice:
        pool && typeof band.tickLower === 'number'
          ? tickToDisplayPrice(band.tickLower, pool.token0.decimals, pool.token1.decimals)
          : null,
      upperPrice:
        pool && typeof band.tickUpper === 'number'
          ? tickToDisplayPrice(band.tickUpper, pool.token0.decimals, pool.token1.decimals)
          : null,
    }));
    return jsonSafe({
      vault: live,
      projection: projected ?? null,
      position,
      walletBalances,
      pool,
      display: {
        price: displayPrice,
        priceApproximate: true,
        bands: displayBands,
      },
      depositorCount: null,
      feeBreakdown: {
        depositFeeBps: '0',
        withdrawalFeeBps: '0',
        performanceFeeBps: info.protocolFeeBps ?? null,
        availability: info.protocolFeeBps === undefined ? 'UNAVAILABLE' : 'VERIFIED_CONTRACT',
      },
      metrics: {
        tvlUsd: null,
        apr7d: null,
        volume24hUsd: null,
        history: null,
        unavailable: ['USD_PRICE_PROVIDER', 'VAULT_HISTORY'],
      },
    });
  }

  async activity(chainId: number, vault: Address, cursor: string | null, limit: number): Promise<unknown> {
    this.assertChain(chainId);
    if (!this.projections) throw new DomainError('STALE_STATE', 'Projection unavailable');
    await this.chain.vaultInfo(vault);
    return this.projections.vaultEvents(chainId, vault, cursor, limit);
  }

  async positions(chainId: number, user: Address, cursor: string | null, limit: number): Promise<unknown> {
    this.assertChain(chainId);
    if (!this.projections) throw new DomainError('STALE_STATE', 'Projection unavailable');
    return this.projections.walletPositions(chainId, user, cursor, limit);
  }

  async bands(chainId: number, vault: Address): Promise<unknown> {
    this.assertChain(chainId);
    const detail = (await this.chain.vaultInfo(vault)) as { bands?: unknown; poolTick?: unknown };
    return jsonSafe({ data: detail.bands ?? [], poolTick: detail.poolTick ?? null });
  }

  async history(
    chainId: number,
    vault: Address,
    kind: 'history' | 'rebalances' = 'history',
  ): Promise<unknown> {
    this.assertChain(chainId);
    await this.chain.vaultInfo(vault);
    return {
      data: [],
      available: false,
      reason: kind === 'history' ? 'HISTORICAL_SNAPSHOTS_UNAVAILABLE' : 'REBALANCE_HISTORY_UNAVAILABLE',
    };
  }

  async buildCreate(command: CreateVaultCommand): Promise<unknown> {
    return serializePlan(await this.chain.buildCreate(command));
  }

  async quoteDeposit(command: DepositCommand): Promise<unknown> {
    const plan = await this.chain.buildDeposit(command);
    return jsonSafe({
      blockNumber: plan.blockNumber,
      expiresAfterBlock: plan.expiresAfterBlock,
      quote: plan.quote,
      requiresApproval: plan.steps.some((step) => step.kind === 'approve'),
    });
  }

  async buildDeposit(command: DepositCommand): Promise<unknown> {
    return serializePlan(await this.chain.buildDeposit(command));
  }

  async quoteWithdraw(command: WithdrawCommand): Promise<unknown> {
    const plan = await this.chain.buildWithdraw(command);
    return jsonSafe({
      blockNumber: plan.blockNumber,
      expiresAfterBlock: plan.expiresAfterBlock,
      quote: plan.quote,
      requiresApproval: plan.steps.some((step) => step.kind === 'approve'),
    });
  }

  async buildWithdraw(command: WithdrawCommand): Promise<unknown> {
    return serializePlan(await this.chain.buildWithdraw(command));
  }

  async buildManagerUpdate(command: ManagerUpdateCommand): Promise<unknown> {
    return serializePlan(await this.chain.buildManagerUpdate(command));
  }

  async buildManagerRebalance(command: ManagerRebalanceCommand): Promise<unknown> {
    return serializePlan(await this.chain.buildManagerRebalance(command));
  }
}
