import { z } from './zod-openapi.js';
import type { Address } from '../../../../packages/domain/src/types.js';
import type {
  CreateVaultCommand,
  DepositCommand,
  PoolKey,
  VaultConfigInput,
  WithdrawCommand,
} from '../../../../packages/domain/src/vault-ui.js';

export const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((value) => value.toLowerCase());
export const HashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
export const DecimalSchema = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
const Int24Schema = z.number().int().min(-8_388_608).max(8_388_607);
const Uint24Schema = z.number().int().min(0).max(16_777_215);
const BpsSchema = z.number().int().min(0).max(10_000);

export const ChainParamsSchema = z.strictObject({ chainId: z.coerce.number().int().positive() });
export const VaultParamsSchema = ChainParamsSchema.extend({ vault: AddressSchema });
export const UserParamsSchema = ChainParamsSchema.extend({ address: AddressSchema });

export const PoolKeySchema = z.strictObject({
  currency0: AddressSchema,
  currency1: AddressSchema,
  fee: Uint24Schema,
  tickSpacing: Int24Schema.positive(),
  hooks: AddressSchema,
});

export const VaultConfigSchema = z.strictObject({
  poolKey: PoolKeySchema,
  strategy: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  shapeId: z.number().int().min(0).max(13),
  centerTick: Int24Schema,
  ticksLeft: Uint24Schema,
  ticksRight: Uint24Schema,
  driftTicks: Uint24Schema,
  trailTicks: Uint24Schema,
  autoRebalance: z.boolean(),
  lockOnFill: z.boolean(),
  depositCap: DecimalSchema,
  baseIsCurrency0: z.boolean(),
  triggerTicksDown: Uint24Schema,
  triggerTicksUp: Uint24Schema,
  rebalanceMethod: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  limitWidthTicks: Uint24Schema,
  token0WeightBps: BpsSchema,
  carpetBps: BpsSchema,
});

export const ShapePreviewSchema = z.strictObject({
  shapeId: z.number().int().min(0).max(13),
  centerTick: Int24Schema,
  ticksLeft: Uint24Schema.positive(),
  ticksRight: Uint24Schema.positive(),
  tickSpacing: Int24Schema.positive(),
});

export const CreateVaultSchema = z.strictObject({
  user: AddressSchema,
  name: z.string().trim().min(1).max(64),
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .regex(/^[A-Za-z0-9._-]+$/),
  config: VaultConfigSchema,
  deposit: z
    .strictObject({
      amount0: DecimalSchema,
      amount1: DecimalSchema,
      automationFunding: DecimalSchema.default('0'),
      toleranceBps: z.number().int().min(0).max(500).default(50),
    })
    .optional(),
});

export const DepositSchema = z.strictObject({
  mode: z.enum(['pair', 'zapSingle', 'zapPair']),
  vault: AddressSchema,
  user: AddressSchema,
  receiver: AddressSchema,
  amount0: DecimalSchema.optional(),
  amount1: DecimalSchema.optional(),
  tokenIn: AddressSchema.optional(),
  amountIn: DecimalSchema.optional(),
  toleranceBps: z.number().int().min(0).max(500).default(50),
  swapSlippageBps: z.number().int().min(0).max(100).default(50),
});

export const WithdrawSchema = z.strictObject({
  mode: z.enum(['pair', 'zap']),
  vault: AddressSchema,
  user: AddressSchema,
  receiver: AddressSchema,
  shares: DecimalSchema,
  token0ShareBps: z.number().int().min(0).max(10_000).default(5_000),
  toleranceBps: z.number().int().min(0).max(500).default(50),
  swapSlippageBps: z.number().int().min(0).max(100).default(50),
});

export const VaultListQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  strategy: z.enum(['NormalLP', 'BuyDip', 'SellPump']).optional(),
  poolId: HashSchema.optional(),
  wallet: AddressSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  network: z.literal('sepolia').optional(),
  sort: z.enum(['age', 'tvl', 'apr', 'volume']).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
});

export const ManagerUpdateSchema = z.strictObject({
  vault: AddressSchema,
  user: AddressSchema,
  config: VaultConfigSchema,
});

export const ManagerRebalanceSchema = ManagerUpdateSchema.extend({
  newCenterTick: Int24Schema,
  maxSlippageBps: z.number().int().min(0).max(100),
});

export const VaultDetailQuerySchema = z.strictObject({ user: AddressSchema.optional() });
export const PageQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function poolKey(input: z.infer<typeof PoolKeySchema>): PoolKey {
  return input as PoolKey;
}

export function vaultConfig(input: z.infer<typeof VaultConfigSchema>): VaultConfigInput {
  return { ...input, poolKey: poolKey(input.poolKey), depositCap: BigInt(input.depositCap) };
}

export function createCommand(chainId: ChainIdValue, raw: unknown): CreateVaultCommand {
  const input = CreateVaultSchema.parse(raw);
  return {
    chainId,
    user: input.user as Address,
    name: input.name,
    symbol: input.symbol,
    config: vaultConfig(input.config),
    ...(input.deposit
      ? {
          deposit: {
            amount0: BigInt(input.deposit.amount0),
            amount1: BigInt(input.deposit.amount1),
            automationFunding: BigInt(input.deposit.automationFunding),
            toleranceBps: input.deposit.toleranceBps,
          },
        }
      : {}),
  };
}

type ChainIdValue = 11155111;

export function depositCommand(chainId: ChainIdValue, raw: unknown): DepositCommand {
  const input = DepositSchema.parse(raw);
  return {
    chainId,
    mode: input.mode,
    vault: input.vault as Address,
    user: input.user as Address,
    receiver: input.receiver as Address,
    ...(input.amount0 === undefined ? {} : { amount0: BigInt(input.amount0) }),
    ...(input.amount1 === undefined ? {} : { amount1: BigInt(input.amount1) }),
    ...(input.tokenIn === undefined ? {} : { tokenIn: input.tokenIn as Address }),
    ...(input.amountIn === undefined ? {} : { amountIn: BigInt(input.amountIn) }),
    toleranceBps: input.toleranceBps,
    swapSlippageBps: input.swapSlippageBps,
  };
}

export function withdrawCommand(chainId: ChainIdValue, raw: unknown): WithdrawCommand {
  const input = WithdrawSchema.parse(raw);
  return {
    chainId,
    mode: input.mode,
    vault: input.vault as Address,
    user: input.user as Address,
    receiver: input.receiver as Address,
    shares: BigInt(input.shares),
    token0ShareBps: input.token0ShareBps,
    toleranceBps: input.toleranceBps,
    swapSlippageBps: input.swapSlippageBps,
  };
}
