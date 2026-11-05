import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  decodeErrorResult,
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
  fallback,
  getAddress,
  http,
  type Abi,
} from 'viem';
import { DomainError } from '../../domain/src/errors.js';
import type { VaultUiChainPort } from '../../domain/src/ports.js';
import type { Address, ChainId } from '../../domain/src/types.js';
import {
  MAX_SWAP_SLIPPAGE_BPS,
  MIN_AUTOMATION_FUNDING,
  NATIVE_TOKEN,
  applyTolerance,
  formatTokenAmount,
  validateVaultConfig,
  type CreateVaultCommand,
  type DepositCommand,
  type ManagerRebalanceCommand,
  type ManagerUpdateCommand,
  type PoolDescriptor,
  type PoolStatus,
  type SimulationStatus,
  type TokenMetadata,
  type TransactionPlan,
  type TransactionStep,
  type VaultConfigInput,
  type WithdrawCommand,
} from '../../domain/src/vault-ui.js';

type ContractAddresses = Readonly<{
  VAULT_FACTORY: Address;
  VAULT_LENS: Address;
  ZAP: Address;
  SHAPE_LIBRARY: Address;
  PRICE_GUARD: Address;
  VAULT_M5_MODULE: Address;
  VAULT_M6_MODULE: Address;
}>;

const erc20Abi = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

function asBigInt(value: unknown, label: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  throw new Error(`Invalid ${label}`);
}

function asTuple(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function contractAbi(name: string): Abi {
  const url = new URL(`../../../../packages/adapters/abis/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8').replace(/^\uFEFF/, '')) as Abi;
}

function configTuple(config: VaultConfigInput): readonly unknown[] {
  return [
    [
      getAddress(config.poolKey.currency0),
      getAddress(config.poolKey.currency1),
      config.poolKey.fee,
      config.poolKey.tickSpacing,
      getAddress(config.poolKey.hooks),
    ],
    config.strategy,
    config.shapeId,
    config.centerTick,
    config.ticksLeft,
    config.ticksRight,
    config.driftTicks,
    config.trailTicks,
    config.autoRebalance,
    config.lockOnFill,
    config.depositCap,
    config.baseIsCurrency0,
    config.triggerTicksDown,
    config.triggerTicksUp,
    config.rebalanceMethod,
    config.limitWidthTicks,
    config.token0WeightBps,
    config.carpetBps,
  ];
}

export class ViemVaultUiAdapter implements VaultUiChainPort {
  private readonly client;
  private readonly abis = {
    factory: contractAbi('VaultFactory'),
    lens: contractAbi('VaultLens'),
    vault: contractAbi('Vault'),
    vaultM5: contractAbi('VaultM5Module'),
    vaultM6: contractAbi('VaultM6Module'),
    zap: contractAbi('Zap'),
    shapes: contractAbi('ShapeLibrary'),
    priceGuard: contractAbi('PriceGuard'),
  };
  private readonly errors: Abi;

  constructor(
    rpcUrls: readonly string[],
    private readonly chainId: ChainId,
    private readonly contracts: ContractAddresses,
    private readonly pools: readonly PoolDescriptor[],
  ) {
    const primary = rpcUrls[0];
    if (!primary) throw new Error('At least one RPC URL is required');
    this.client = createPublicClient({
      chain: defineChain({
        id: chainId,
        name: 'Ethereum Sepolia',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [...rpcUrls] } },
      }),
      transport:
        rpcUrls.length === 1
          ? http(primary, { timeout: 10_000, retryCount: 1 })
          : fallback(rpcUrls.map((url) => http(url, { timeout: 10_000, retryCount: 1 }))),
    });
    this.errors = [
      ...this.abis.factory,
      ...this.abis.vault,
      ...this.abis.vaultM5,
      ...this.abis.zap,
      ...this.abis.priceGuard,
    ];
  }

  private async read(
    address: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[] = [],
  ): Promise<unknown> {
    return this.client.readContract({
      address: getAddress(address),
      abi,
      functionName,
      args,
    });
  }

  private encode(abi: Abi, functionName: string, args: readonly unknown[]): `0x${string}` {
    return encodeFunctionData({ abi, functionName, args });
  }

  private revertName(error: unknown): string {
    if (error instanceof BaseError) {
      const reverted = error.walk((candidate) => candidate instanceof ContractFunctionRevertedError);
      if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName)
        return reverted.data.errorName;
      if (reverted instanceof ContractFunctionRevertedError && reverted.raw) {
        try {
          return decodeErrorResult({ abi: this.errors, data: reverted.raw }).errorName;
        } catch {
          return 'UNKNOWN_CONTRACT_REVERT';
        }
      }
    }
    return 'SIMULATION_REVERTED';
  }

  private async simulation(
    user: Address,
    to: Address,
    data: `0x${string}`,
    value: bigint,
  ): Promise<{
    status: Exclude<SimulationStatus, 'PENDING_APPROVAL'>;
    revert?: string;
    result?: `0x${string}`;
  }> {
    try {
      const response = await this.client.call({
        account: getAddress(user),
        to: getAddress(to),
        data,
        value,
      });
      return { status: 'PASSED', ...(response.data ? { result: response.data } : {}) };
    } catch (error) {
      return { status: 'FAILED', revert: this.revertName(error) };
    }
  }

  private async ensureVault(vault: Address): Promise<void> {
    const known = await this.read(this.contracts.VAULT_FACTORY, this.abis.factory, 'isVault', [vault]);
    if (known !== true) throw new DomainError('NOT_FOUND', 'Unknown factory vault');
  }

  private async tokenMetadata(token: Address): Promise<TokenMetadata> {
    if (token.toLowerCase() === NATIVE_TOKEN) return { address: NATIVE_TOKEN, symbol: 'ETH', decimals: 18 };
    const [symbol, decimals] = await Promise.all([
      this.read(token, erc20Abi, 'symbol'),
      this.read(token, erc20Abi, 'decimals'),
    ]);
    if (typeof symbol !== 'string' || typeof decimals !== 'number') throw new Error('Invalid token metadata');
    return { address: token.toLowerCase() as Address, symbol, decimals };
  }

  private async balance(token: Address, owner: Address): Promise<bigint> {
    if (token.toLowerCase() === NATIVE_TOKEN) return this.client.getBalance({ address: getAddress(owner) });
    return asBigInt(await this.read(token, erc20Abi, 'balanceOf', [owner]), 'token balance');
  }

  private async approval(
    token: Address,
    owner: Address,
    spender: Address,
    amount: bigint,
  ): Promise<TransactionStep | null> {
    if (amount === 0n || token.toLowerCase() === NATIVE_TOKEN) return null;
    const [balance, allowance] = await Promise.all([
      this.balance(token, owner),
      this.read(token, erc20Abi, 'allowance', [owner, spender]).then((value) => asBigInt(value, 'allowance')),
    ]);
    if (balance < amount) throw new DomainError('INVALID_INPUT', 'Insufficient token balance');
    if (allowance >= amount) return null;
    const data = this.encode(erc20Abi, 'approve', [spender, amount]);
    const simulation = await this.simulation(owner, token, data, 0n);
    return {
      kind: 'approve',
      to: token,
      data,
      value: 0n,
      summary: `Approve exact amount ${amount.toString()}`,
      simulation,
    };
  }

  private async nativeBalance(owner: Address, required: bigint): Promise<void> {
    if ((await this.balance(NATIVE_TOKEN, owner)) < required)
      throw new DomainError('INVALID_INPUT', 'Insufficient native balance');
  }

  private pendingCall(to: Address, data: `0x${string}`, value: bigint, summary: string): TransactionStep {
    return {
      kind: 'call',
      to,
      data,
      value,
      summary,
      simulation: { status: 'PENDING_APPROVAL' },
    };
  }

  private async simulatedCall(
    user: Address,
    to: Address,
    data: `0x${string}`,
    value: bigint,
    summary: string,
  ): Promise<TransactionStep> {
    return {
      kind: 'call',
      to,
      data,
      value,
      summary,
      simulation: await this.simulation(user, to, data, value),
    };
  }

  async listPools(): Promise<readonly PoolStatus[]> {
    return Promise.all(
      this.pools.map(async (pool) => {
        const key = pool.key;
        const [ruleValue, trustValue, reference, token0, token1] = await Promise.all([
          this.read(this.contracts.VAULT_FACTORY, this.abis.factory, 'poolRule', [pool.id]),
          this.read(this.contracts.PRICE_GUARD, this.abis.priceGuard, 'isPriceTrusted', [key]),
          this.read(this.contracts.PRICE_GUARD, this.abis.priceGuard, 'referenceSqrtPriceX96', [key]).catch(
            () => null,
          ),
          this.tokenMetadata(key.currency0),
          this.tokenMetadata(key.currency1),
        ]);
        const rule = asTuple(ruleValue, 'pool rule');
        const trust = asTuple(trustValue, 'price trust');
        return {
          ...pool,
          allowed: rule[0] === true,
          baseIsCurrency0: rule[1] === true,
          maxDepositCap: asBigInt(rule[2], 'maximum deposit cap'),
          priceTrusted: trust[0] === true,
          priceDeviationBps: asBigInt(trust[1], 'price deviation'),
          referenceSqrtPriceX96: reference === null ? null : asBigInt(reference, 'reference price'),
          token0,
          token1,
        };
      }),
    );
  }

  async listShapes(): Promise<readonly { id: number; valid: boolean }[]> {
    return Promise.all(
      Array.from({ length: 14 }, async (_value, id) => ({
        id,
        valid:
          (await this.read(this.contracts.SHAPE_LIBRARY, this.abis.shapes, 'isValidShape', [id])) === true,
      })),
    );
  }

  async previewShape(input: {
    shapeId: number;
    centerTick: number;
    ticksLeft: number;
    ticksRight: number;
    tickSpacing: number;
  }): Promise<{ bands: readonly unknown[]; weights: readonly number[] }> {
    const result = asTuple(
      await this.read(this.contracts.SHAPE_LIBRARY, this.abis.shapes, 'computeBands', [
        input.shapeId,
        input.centerTick,
        input.ticksLeft,
        input.ticksRight,
        input.tickSpacing,
      ]),
      'shape preview',
    );
    return {
      bands: Array.isArray(result[0]) ? result[0] : [],
      weights: Array.isArray(result[1]) ? result[1].map((value) => Number(value)) : [],
    };
  }

  async validateConfig(config: VaultConfigInput): Promise<{
    pool: PoolStatus;
    violations: readonly { field: string; code: string }[];
  }> {
    const pool = (await this.listPools()).find(
      (candidate) =>
        candidate.id.toLowerCase() ===
        this.pools
          .find(
            (entry) =>
              entry.key.currency0.toLowerCase() === config.poolKey.currency0.toLowerCase() &&
              entry.key.currency1.toLowerCase() === config.poolKey.currency1.toLowerCase() &&
              entry.key.fee === config.poolKey.fee &&
              entry.key.tickSpacing === config.poolKey.tickSpacing &&
              entry.key.hooks.toLowerCase() === config.poolKey.hooks.toLowerCase(),
          )
          ?.id.toLowerCase(),
    );
    if (!pool) throw new DomainError('INVALID_INPUT', 'Pool is not in the deployment registry');
    const [shapeValid, strategyAddress] = await Promise.all([
      this.read(this.contracts.SHAPE_LIBRARY, this.abis.shapes, 'isValidShape', [config.shapeId]),
      this.read(this.contracts.VAULT_FACTORY, this.abis.factory, 'strategyOf', [config.strategy]),
    ]);
    const violations: Array<{ field: string; code: string }> = [
      ...validateVaultConfig(config, pool.maxDepositCap),
    ];
    if (!pool.allowed) violations.push({ field: 'poolKey', code: 'PoolNotAllowed' });
    if (!pool.priceTrusted) violations.push({ field: 'poolKey', code: 'PriceUntrusted' });
    if (pool.baseIsCurrency0 !== config.baseIsCurrency0)
      violations.push({ field: 'baseIsCurrency0', code: 'InvalidBaseOrientation' });
    if (shapeValid !== true) violations.push({ field: 'shapeId', code: 'InvalidShape' });
    if (typeof strategyAddress !== 'string' || strategyAddress.toLowerCase() === NATIVE_TOKEN.toLowerCase())
      violations.push({ field: 'strategy', code: 'StrategyUnavailable' });
    return { pool, violations };
  }

  async vaultInfo(vault: Address): Promise<unknown> {
    await this.ensureVault(vault);
    return this.read(this.contracts.VAULT_LENS, this.abis.lens, 'vaultInfo', [vault]);
  }

  async userPosition(vault: Address, user: Address): Promise<unknown> {
    await this.ensureVault(vault);
    return this.read(this.contracts.VAULT_LENS, this.abis.lens, 'userPosition', [vault, user]);
  }

  async walletBalances(vault: Address, user: Address): Promise<unknown> {
    const info = asRecord(await this.vaultInfo(vault), 'vault info');
    const config = asRecord(info.config, 'vault config');
    const poolKey = asRecord(config.poolKey, 'pool key');
    const currency0 = String(poolKey.currency0) as Address;
    const currency1 = String(poolKey.currency1) as Address;
    const [token0, token1, balance0, balance1, shares] = await Promise.all([
      this.tokenMetadata(currency0),
      this.tokenMetadata(currency1),
      this.balance(currency0, user),
      this.balance(currency1, user),
      this.balance(vault, user),
    ]);
    return {
      token0: { ...token0, raw: balance0, formatted: formatTokenAmount(balance0, token0.decimals) },
      token1: { ...token1, raw: balance1, formatted: formatTokenAmount(balance1, token1.decimals) },
      vaultShares: { raw: shares, formatted: formatTokenAmount(shares, 18) },
    };
  }

  private async assertManagerCommand(command: ManagerUpdateCommand): Promise<Record<string, unknown>> {
    if (command.chainId !== this.chainId) throw new DomainError('INVALID_INPUT', 'Unsupported chain');
    const info = asRecord(await this.vaultInfo(command.vault), 'vault info');
    if (String(info.manager).toLowerCase() !== command.user.toLowerCase())
      throw new DomainError('UNAUTHORIZED', 'Only the vault manager can perform this action');
    const current = asRecord(info.config, 'current vault config');
    const currentPool = asRecord(current.poolKey, 'current pool key');
    const proposed = command.config;
    if (
      String(currentPool.currency0).toLowerCase() !== proposed.poolKey.currency0.toLowerCase() ||
      String(currentPool.currency1).toLowerCase() !== proposed.poolKey.currency1.toLowerCase() ||
      Number(currentPool.fee) !== proposed.poolKey.fee ||
      Number(currentPool.tickSpacing) !== proposed.poolKey.tickSpacing ||
      String(currentPool.hooks).toLowerCase() !== proposed.poolKey.hooks.toLowerCase() ||
      Number(current.strategy) !== proposed.strategy ||
      asBigInt(current.depositCap, 'current deposit cap') !== proposed.depositCap ||
      Boolean(current.baseIsCurrency0) !== proposed.baseIsCurrency0
    )
      throw new DomainError('INVALID_INPUT', 'Immutable vault configuration field changed');
    const validation = await this.validateConfig(proposed);
    if (validation.violations.length) throw new DomainError('INVALID_INPUT', 'Vault configuration rejected');
    return info;
  }

  async buildManagerUpdate(command: ManagerUpdateCommand): Promise<TransactionPlan> {
    await this.assertManagerCommand(command);
    const blockNumber = await this.client.getBlockNumber();
    const data = this.encode(this.abis.vaultM6, 'updateConfig', [configTuple(command.config)]);
    return {
      chainId: this.chainId,
      blockNumber,
      steps: [await this.simulatedCall(command.user, command.vault, data, 0n, 'Update vault configuration')],
      quote: {},
      expiresAfterBlock: blockNumber + 2n,
    };
  }

  async buildManagerRebalance(command: ManagerRebalanceCommand): Promise<TransactionPlan> {
    const info = await this.assertManagerCommand(command);
    const currentTick = Number(info.poolTick);
    if (
      !Number.isInteger(currentTick) ||
      command.newCenterTick % command.config.poolKey.tickSpacing !== 0 ||
      Math.abs(command.newCenterTick - currentTick) > 200
    )
      throw new DomainError('INVALID_INPUT', 'Rebalance center is outside the contract limit');
    if (command.maxSlippageBps < 0 || command.maxSlippageBps > MAX_SWAP_SLIPPAGE_BPS)
      throw new DomainError('INVALID_INPUT', 'Swap slippage exceeds the contract cap');
    const blockNumber = await this.client.getBlockNumber();
    const data = this.encode(this.abis.vaultM6, 'managerRebalance', [
      configTuple(command.config),
      [command.newCenterTick, command.maxSlippageBps],
    ]);
    return {
      chainId: this.chainId,
      blockNumber,
      steps: [await this.simulatedCall(command.user, command.vault, data, 0n, 'Manager rebalance')],
      quote: {},
      expiresAfterBlock: blockNumber + 2n,
    };
  }

  async buildCreate(command: CreateVaultCommand): Promise<TransactionPlan> {
    if (command.chainId !== this.chainId) throw new DomainError('INVALID_INPUT', 'Unsupported chain');
    const validation = await this.validateConfig(command.config);
    if (validation.violations.length) throw new DomainError('INVALID_INPUT', 'Vault configuration rejected');
    const blockNumber = await this.client.getBlockNumber();
    const factory = this.contracts.VAULT_FACTORY;
    if (!command.deposit) {
      const data = this.encode(this.abis.factory, 'createVault', [
        configTuple(command.config),
        command.name,
        command.symbol,
      ]);
      return {
        chainId: this.chainId,
        blockNumber,
        steps: [await this.simulatedCall(command.user, factory, data, 0n, 'Create V2 vault')],
        quote: {},
        expiresAfterBlock: blockNumber + 2n,
      };
    }
    const deposit = command.deposit;
    if (deposit.automationFunding !== 0n && deposit.automationFunding < MIN_AUTOMATION_FUNDING)
      throw new DomainError('INVALID_INPUT', 'Automation funding is below the contract minimum');
    const nativeValue =
      (command.config.poolKey.currency0.toLowerCase() === NATIVE_TOKEN ? deposit.amount0 : 0n) +
      (command.config.poolKey.currency1.toLowerCase() === NATIVE_TOKEN ? deposit.amount1 : 0n) +
      deposit.automationFunding;
    await this.nativeBalance(command.user, nativeValue);
    const approvals = (
      await Promise.all([
        this.approval(command.config.poolKey.currency0, command.user, factory, deposit.amount0),
        this.approval(command.config.poolKey.currency1, command.user, factory, deposit.amount1),
      ])
    ).filter((step): step is TransactionStep => step !== null);
    if (approvals.length) {
      return {
        chainId: this.chainId,
        blockNumber,
        steps: approvals,
        quote: { status: 'APPROVAL_REQUIRED' },
        expiresAfterBlock: blockNumber + 2n,
      };
    }
    const provisional = this.encode(this.abis.factory, 'createVaultAndDeposit', [
      configTuple(command.config),
      command.name,
      command.symbol,
      [deposit.amount0, deposit.amount1, 0n, deposit.automationFunding],
    ]);
    const first = await this.simulation(command.user, factory, provisional, nativeValue);
    if (first.status === 'FAILED' || !first.result)
      return {
        chainId: this.chainId,
        blockNumber,
        steps: [
          {
            kind: 'call',
            to: factory,
            data: provisional,
            value: nativeValue,
            summary: 'Create V2 vault and deposit',
            simulation: first,
          },
        ],
        quote: { expectedShares: null, minimumShares: null },
        expiresAfterBlock: blockNumber + 2n,
      };
    const decoded = asTuple(
      decodeFunctionResult({
        abi: this.abis.factory,
        functionName: 'createVaultAndDeposit',
        data: first.result,
      }),
      'create result',
    );
    const expectedShares = asBigInt(decoded[1], 'created shares');
    const minimumShares = applyTolerance(expectedShares, deposit.toleranceBps);
    const data = this.encode(this.abis.factory, 'createVaultAndDeposit', [
      configTuple(command.config),
      command.name,
      command.symbol,
      [deposit.amount0, deposit.amount1, minimumShares, deposit.automationFunding],
    ]);
    return {
      chainId: this.chainId,
      blockNumber,
      steps: [
        await this.simulatedCall(command.user, factory, data, nativeValue, 'Create V2 vault and deposit'),
      ],
      quote: { expectedShares, minimumShares },
      expiresAfterBlock: blockNumber + 2n,
    };
  }

  async buildDeposit(command: DepositCommand): Promise<TransactionPlan> {
    if (command.chainId !== this.chainId) throw new DomainError('INVALID_INPUT', 'Unsupported chain');
    if (command.swapSlippageBps < 0 || command.swapSlippageBps > MAX_SWAP_SLIPPAGE_BPS)
      throw new DomainError('INVALID_INPUT', 'Swap slippage exceeds the contract cap');
    await this.ensureVault(command.vault);
    const info = (await this.vaultInfo(command.vault)) as {
      config?: { poolKey?: { currency0?: Address; currency1?: Address } };
    };
    const currency0 = info.config?.poolKey?.currency0;
    const currency1 = info.config?.poolKey?.currency1;
    if (!currency0 || !currency1) throw new Error('Vault pool currencies unavailable');
    const blockNumber = await this.client.getBlockNumber();
    let expectedShares: bigint | null;
    let minimumShares: bigint | null;
    let target: Address;
    let value: bigint;
    let data: `0x${string}`;
    const approvals: TransactionStep[] = [];
    if (command.mode === 'zapSingle') {
      if (!command.tokenIn || command.amountIn === undefined || command.amountIn <= 0n)
        throw new DomainError('INVALID_INPUT', 'Single-token deposit amount is required');
      target = this.contracts.ZAP;
      const quote = asTuple(
        await this.read(target, this.abis.zap, 'quoteZap', [
          command.vault,
          command.tokenIn,
          command.amountIn,
        ]),
        'zap quote',
      );
      expectedShares = asBigInt(quote[1], 'expected shares');
      minimumShares = applyTolerance(expectedShares, command.toleranceBps);
      value = command.tokenIn.toLowerCase() === NATIVE_TOKEN ? command.amountIn : 0n;
      await this.nativeBalance(command.user, value);
      const approval = await this.approval(command.tokenIn, command.user, target, command.amountIn);
      if (approval) approvals.push(approval);
      data = this.encode(this.abis.zap, 'zapDeposit', [
        command.vault,
        command.tokenIn,
        command.amountIn,
        minimumShares,
        command.swapSlippageBps,
        command.receiver,
      ]);
    } else {
      const amount0 = command.amount0 ?? 0n;
      const amount1 = command.amount1 ?? 0n;
      if (amount0 < 0n || amount1 < 0n || amount0 + amount1 <= 0n)
        throw new DomainError('INVALID_INPUT', 'Pair deposit amount is required');
      target = command.mode === 'zapPair' ? this.contracts.ZAP : command.vault;
      value =
        (currency0.toLowerCase() === NATIVE_TOKEN ? amount0 : 0n) +
        (currency1.toLowerCase() === NATIVE_TOKEN ? amount1 : 0n);
      await this.nativeBalance(command.user, value);
      const builtApprovals = await Promise.all([
        this.approval(currency0, command.user, target, amount0),
        this.approval(currency1, command.user, target, amount1),
      ]);
      approvals.push(...builtApprovals.filter((step): step is TransactionStep => step !== null));
      if (command.mode === 'zapPair') {
        const quote = asTuple(
          await this.read(this.contracts.ZAP, this.abis.zap, 'quoteZapPair', [
            command.vault,
            amount0,
            amount1,
          ]),
          'zap pair quote',
        );
        expectedShares = asBigInt(quote[1], 'expected shares');
        minimumShares = applyTolerance(expectedShares, command.toleranceBps);
        data = this.encode(this.abis.zap, 'zapDepositPair', [
          command.vault,
          amount0,
          amount1,
          minimumShares,
          command.swapSlippageBps,
          command.receiver,
        ]);
      } else {
        if (approvals.length)
          return {
            chainId: this.chainId,
            blockNumber,
            steps: approvals,
            quote: { status: 'APPROVAL_REQUIRED' },
            expiresAfterBlock: blockNumber + 2n,
          };
        const provisional = this.encode(this.abis.vault, 'depositPair', [
          amount0,
          amount1,
          0n,
          command.receiver,
        ]);
        const simulated = await this.simulation(command.user, command.vault, provisional, value);
        if (simulated.status === 'FAILED' || !simulated.result)
          return {
            chainId: this.chainId,
            blockNumber,
            steps: [
              {
                kind: 'call',
                to: command.vault,
                data: provisional,
                value,
                summary: 'Deposit token pair',
                simulation: simulated,
              },
            ],
            quote: { expectedShares: null, minimumShares: null },
            expiresAfterBlock: blockNumber + 2n,
          };
        const decoded = asTuple(
          decodeFunctionResult({ abi: this.abis.vault, functionName: 'depositPair', data: simulated.result }),
          'deposit result',
        );
        expectedShares = asBigInt(decoded[0], 'expected shares');
        minimumShares = applyTolerance(expectedShares, command.toleranceBps);
        data = this.encode(this.abis.vault, 'depositPair', [
          amount0,
          amount1,
          minimumShares,
          command.receiver,
        ]);
      }
    }
    const call = approvals.length
      ? this.pendingCall(target, data, value, 'Deposit into V2 vault')
      : await this.simulatedCall(command.user, target, data, value, 'Deposit into V2 vault');
    return {
      chainId: this.chainId,
      blockNumber,
      steps: [...approvals, call],
      quote: { expectedShares, minimumShares },
      expiresAfterBlock: blockNumber + 2n,
    };
  }

  async buildWithdraw(command: WithdrawCommand): Promise<TransactionPlan> {
    if (command.chainId !== this.chainId) throw new DomainError('INVALID_INPUT', 'Unsupported chain');
    if (command.shares <= 0n) throw new DomainError('INVALID_INPUT', 'Shares must be positive');
    if (command.token0ShareBps < 0 || command.token0ShareBps > 10_000)
      throw new DomainError('INVALID_INPUT', 'Invalid token split');
    if (command.swapSlippageBps < 0 || command.swapSlippageBps > MAX_SWAP_SLIPPAGE_BPS)
      throw new DomainError('INVALID_INPUT', 'Swap slippage exceeds the contract cap');
    await this.ensureVault(command.vault);
    const shares = asBigInt(
      await this.read(command.vault, erc20Abi, 'balanceOf', [command.user]),
      'vault shares',
    );
    if (shares < command.shares) throw new DomainError('INVALID_INPUT', 'Insufficient vault shares');
    const blockNumber = await this.client.getBlockNumber();
    let expected0: bigint;
    let expected1: bigint;
    let target: Address;
    let data: `0x${string}`;
    const approvals: TransactionStep[] = [];
    if (command.mode === 'zap') {
      target = this.contracts.ZAP;
      const quote = asTuple(
        await this.read(target, this.abis.zap, 'quoteZapWithdraw', [
          command.vault,
          command.shares,
          command.token0ShareBps,
        ]),
        'zap withdrawal quote',
      );
      expected0 = asBigInt(quote[0], 'expected token0');
      expected1 = asBigInt(quote[1], 'expected token1');
      const approval = await this.approval(command.vault, command.user, target, command.shares);
      if (approval) approvals.push(approval);
      data = this.encode(this.abis.zap, 'zapWithdraw', [
        command.vault,
        command.shares,
        command.token0ShareBps,
        applyTolerance(expected0, command.toleranceBps),
        applyTolerance(expected1, command.toleranceBps),
        command.swapSlippageBps,
        command.receiver,
      ]);
    } else {
      target = command.vault;
      const preview = asTuple(
        await this.read(this.contracts.VAULT_M5_MODULE, this.abis.vaultM5, 'previewWithdrawPair', [
          command.vault,
          command.shares,
        ]),
        'withdrawal preview',
      );
      expected0 = asBigInt(preview[0], 'expected token0');
      expected1 = asBigInt(preview[1], 'expected token1');
      data = this.encode(this.abis.vaultM5, 'withdrawPair', [
        command.shares,
        applyTolerance(expected0, command.toleranceBps),
        applyTolerance(expected1, command.toleranceBps),
        command.receiver,
      ]);
    }
    const call = approvals.length
      ? this.pendingCall(target, data, 0n, 'Withdraw from V2 vault')
      : await this.simulatedCall(command.user, target, data, 0n, 'Withdraw from V2 vault');
    return {
      chainId: this.chainId,
      blockNumber,
      steps: [...approvals, call],
      quote: {
        expectedAmount0: expected0,
        expectedAmount1: expected1,
        minimumAmount0: applyTolerance(expected0, command.toleranceBps),
        minimumAmount1: applyTolerance(expected1, command.toleranceBps),
      },
      expiresAfterBlock: blockNumber + 2n,
    };
  }
}
