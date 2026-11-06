import { DomainError } from './errors.js';
import type { Address, ChainId } from './types.js';

export const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000' as Address;
export const MAX_TOLERANCE_BPS = 500;
export const MAX_SWAP_SLIPPAGE_BPS = 100;
export const MIN_AUTOMATION_FUNDING = 1_000_000_000_000_000n;

export interface PoolKey {
  readonly currency0: Address;
  readonly currency1: Address;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly hooks: Address;
}

export interface VaultConfigInput {
  readonly poolKey: PoolKey;
  readonly strategy: 0 | 1 | 2;
  readonly shapeId: number;
  readonly centerTick: number;
  readonly ticksLeft: number;
  readonly ticksRight: number;
  readonly driftTicks: number;
  readonly trailTicks: number;
  readonly autoRebalance: boolean;
  readonly lockOnFill: boolean;
  readonly depositCap: bigint;
  readonly baseIsCurrency0: boolean;
  readonly triggerTicksDown: number;
  readonly triggerTicksUp: number;
  readonly rebalanceMethod: 0 | 1 | 2;
  readonly limitWidthTicks: number;
  readonly token0WeightBps: number;
  readonly carpetBps: number;
}

export interface ConfigViolation {
  readonly field: keyof VaultConfigInput | 'poolKey';
  readonly code:
    | 'InvalidGeometry'
    | 'InvalidShape'
    | 'InvalidDrift'
    | 'InvalidTrail'
    | 'InvalidTrigger'
    | 'InvalidLimit'
    | 'InvalidWeight'
    | 'InvalidDepositCap';
}

export interface PoolDescriptor {
  readonly id: `0x${string}`;
  readonly key: PoolKey;
  readonly label: string;
}

export interface PoolStatus extends PoolDescriptor {
  readonly allowed: boolean;
  readonly baseIsCurrency0: boolean;
  readonly maxDepositCap: bigint;
  readonly priceTrusted: boolean;
  readonly priceDeviationBps: bigint;
  readonly referenceSqrtPriceX96: bigint | null;
  readonly token0: TokenMetadata;
  readonly token1: TokenMetadata;
}

export interface TokenMetadata {
  readonly address: Address;
  readonly symbol: string;
  readonly decimals: number;
}

export type SimulationStatus = 'PASSED' | 'FAILED' | 'PENDING_APPROVAL';

export interface TransactionStep {
  readonly kind: 'approve' | 'call';
  readonly to: Address;
  readonly data: `0x${string}`;
  readonly value: bigint;
  readonly summary: string;
  readonly simulation: {
    readonly status: SimulationStatus;
    readonly revert?: string;
  };
}

export interface TransactionPlan {
  readonly chainId: ChainId;
  readonly blockNumber: bigint;
  readonly steps: readonly TransactionStep[];
  readonly quote: Readonly<Record<string, bigint | string | null>>;
  readonly expiresAfterBlock: bigint;
}

export interface DepositCommand {
  readonly chainId: ChainId;
  readonly mode: 'pair' | 'zapSingle' | 'zapPair';
  readonly vault: Address;
  readonly user: Address;
  readonly receiver: Address;
  readonly amount0?: bigint;
  readonly amount1?: bigint;
  readonly tokenIn?: Address;
  readonly amountIn?: bigint;
  readonly toleranceBps: number;
  readonly swapSlippageBps: number;
}

export interface WithdrawCommand {
  readonly chainId: ChainId;
  readonly mode: 'pair' | 'zap';
  readonly vault: Address;
  readonly user: Address;
  readonly receiver: Address;
  readonly shares: bigint;
  readonly token0ShareBps: number;
  readonly toleranceBps: number;
  readonly swapSlippageBps: number;
}

export interface ManagerUpdateCommand {
  readonly chainId: ChainId;
  readonly vault: Address;
  readonly user: Address;
  readonly config: VaultConfigInput;
}

export interface ManagerRebalanceCommand extends ManagerUpdateCommand {
  readonly newCenterTick: number;
  readonly maxSlippageBps: number;
}

export interface CreateVaultCommand {
  readonly chainId: ChainId;
  readonly user: Address;
  readonly name: string;
  readonly symbol: string;
  readonly config: VaultConfigInput;
  readonly deposit?: {
    readonly amount0: bigint;
    readonly amount1: bigint;
    readonly automationFunding: bigint;
    readonly toleranceBps: number;
  };
}

export function applyTolerance(value: bigint, toleranceBps: number): bigint {
  if (!Number.isInteger(toleranceBps) || toleranceBps < 0 || toleranceBps > MAX_TOLERANCE_BPS)
    throw new DomainError('INVALID_INPUT', 'Invalid tolerance');
  return (value * BigInt(10_000 - toleranceBps)) / 10_000n;
}

export const SHAPE_CATALOGUE = [
  { id: 0, name: 'Exponential Preset', bandCount: 5 },
  { id: 1, name: 'Narrow Stable', bandCount: 1 },
  { id: 2, name: 'Wide Stable', bandCount: 3 },
  { id: 3, name: 'Narrow Volatile', bandCount: 3 },
  { id: 4, name: 'Wide Volatile', bandCount: 5 },
  { id: 5, name: 'Single-Tick', bandCount: 1 },
  { id: 6, name: 'Full Range', bandCount: 1 },
  { id: 7, name: 'Custom', bandCount: 1 },
  { id: 8, name: 'Exponential', bandCount: 10 },
  { id: 9, name: 'Inverted Exponential', bandCount: 10 },
  { id: 10, name: 'Uniform', bandCount: 10 },
  { id: 11, name: 'Gaussian', bandCount: 10 },
  { id: 12, name: 'Inverted Gaussian', bandCount: 10 },
  { id: 13, name: 'Triangle', bandCount: 10 },
] as const;

export const STRATEGY_CATALOGUE = [
  { id: 0, key: 'NormalLP', name: 'Normal LP', allowedShapeIds: [0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13] },
  { id: 1, key: 'BuyDip', name: 'Buy the Dip', allowedShapeIds: [3, 4, 7, 8, 9, 10, 11, 12, 13] },
  { id: 2, key: 'SellPump', name: 'Sell the Pump', allowedShapeIds: [3, 4, 7, 8, 9, 10, 11, 12, 13] },
] as const;

export const VOLATILITY_PRESETS = [
  { id: 'narrow', name: 'Narrow', contractFields: ['ticksLeft', 'ticksRight'], suggestedTicks: null },
  { id: 'wide', name: 'Wide', contractFields: ['ticksLeft', 'ticksRight'], suggestedTicks: null },
  { id: 'fullRange', name: 'Full Range', contractFields: ['ticksLeft', 'ticksRight'], suggestedTicks: null },
] as const;

/** Exact decimal formatting for display only; transaction values remain raw bigint strings. */
export function formatTokenAmount(
  raw: bigint,
  decimals: number,
  maximumFractionDigits = Math.min(8, decimals),
): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255)
    throw new Error('Invalid token decimals');
  if (
    !Number.isInteger(maximumFractionDigits) ||
    maximumFractionDigits < 0 ||
    maximumFractionDigits > decimals
  )
    throw new Error('Invalid display precision');
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, '0').slice(0, maximumFractionDigits);
  const trimmed = fraction.replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${trimmed ? `.${trimmed}` : ''}`;
}

/** Approximate human price for charts only. Never use this value for quotes or transaction sizing. */
export function tickToDisplayPrice(tick: number, baseDecimals: number, quoteDecimals: number): string | null {
  if (!Number.isInteger(tick) || tick < -887272 || tick > 887272) return null;
  const value = 1.0001 ** tick * 10 ** (baseDecimals - quoteDecimals);
  return Number.isFinite(value) && value > 0 ? value.toPrecision(12) : null;
}

export function validateVaultConfig(
  config: VaultConfigInput,
  maximumDepositCap?: bigint,
): readonly ConfigViolation[] {
  const result: ConfigViolation[] = [];
  const add = (field: ConfigViolation['field'], code: ConfigViolation['code']) =>
    result.push({ field, code });
  const spacing = config.poolKey.tickSpacing;
  const validRange =
    config.strategy === 1
      ? config.ticksLeft > 0 && config.ticksRight === 0
      : config.strategy === 2
        ? config.ticksLeft === 0 && config.ticksRight > 0
        : config.ticksLeft > 0 && config.ticksRight > 0;
  if (
    spacing <= 0 ||
    config.centerTick % spacing !== 0 ||
    !validRange ||
    config.ticksLeft % spacing !== 0 ||
    config.ticksRight % spacing !== 0
  )
    add('centerTick', 'InvalidGeometry');
  const oneSided = config.strategy === 1 || config.strategy === 2;
  const shapeAllowed = oneSided
    ? [3, 4, 7, 8, 9, 10, 11, 12, 13].includes(config.shapeId)
    : config.shapeId >= 0 && config.shapeId <= 13 && ![5, 6].includes(config.shapeId);
  if (!shapeAllowed) add('shapeId', 'InvalidShape');
  if (
    oneSided
      ? config.driftTicks !== 0
      : config.driftTicks >= config.ticksLeft || config.driftTicks >= config.ticksRight
  )
    add('driftTicks', 'InvalidDrift');
  if (oneSided ? config.trailTicks <= 0 : config.trailTicks !== 0 || config.lockOnFill)
    add('trailTicks', 'InvalidTrail');
  if (oneSided && (config.triggerTicksDown !== 0 || config.triggerTicksUp !== 0))
    add('triggerTicksDown', 'InvalidTrigger');
  if (
    config.limitWidthTicks < 0 ||
    config.limitWidthTicks > 10_000 ||
    config.limitWidthTicks % spacing !== 0 ||
    (config.rebalanceMethod === 1 && config.limitWidthTicks === 0) ||
    (oneSided && (config.rebalanceMethod !== 0 || config.limitWidthTicks !== 0))
  )
    add('limitWidthTicks', 'InvalidLimit');
  if (
    config.token0WeightBps < 0 ||
    config.token0WeightBps >= 10_000 ||
    config.carpetBps < 0 ||
    config.carpetBps > 2_500 ||
    (oneSided && (config.token0WeightBps !== 0 || config.carpetBps !== 0)) ||
    (config.token0WeightBps !== 0 &&
      (config.rebalanceMethod === 2 ||
        config.driftTicks !== 0 ||
        config.triggerTicksDown !== 0 ||
        config.triggerTicksUp !== 0))
  )
    add('token0WeightBps', 'InvalidWeight');
  if (config.depositCap <= 0n || (maximumDepositCap !== undefined && config.depositCap > maximumDepositCap))
    add('depositCap', 'InvalidDepositCap');
  return result;
}
