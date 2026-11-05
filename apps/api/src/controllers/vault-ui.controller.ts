import type { RequestHandler } from 'express';
import { z } from 'zod';
import { DomainError } from '../../../../packages/domain/src/errors.js';
import type { Address } from '../../../../packages/domain/src/types.js';
import type { ApiDependencies } from '../api-dependencies.js';
import { presentJson } from '../presenters/json-response.presenter.js';
import {
  ChainParamsSchema,
  PageQuerySchema,
  ShapePreviewSchema,
  ManagerRebalanceSchema,
  ManagerUpdateSchema,
  UserParamsSchema,
  VaultConfigSchema,
  VaultDetailQuerySchema,
  VaultListQuerySchema,
  VaultParamsSchema,
  createCommand,
  depositCommand,
  vaultConfig,
  withdrawCommand,
} from '../validators/vault-ui.schemas.js';

function handler(operation: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    try {
      await operation(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function service(dependencies: ApiDependencies) {
  if (!dependencies.vaultUiService)
    throw Object.assign(new Error('V2_API_UNAVAILABLE'), { status: 503, code: 'V2_API_UNAVAILABLE' });
  return dependencies.vaultUiService;
}

function chain(value: unknown, active: number): 11155111 {
  const rawChainId =
    value && typeof value === 'object' && 'chainId' in value
      ? (value as { chainId?: unknown }).chainId
      : value;
  const parsed = ChainParamsSchema.parse({ chainId: rawChainId }).chainId;
  if (parsed !== active) throw new DomainError('INVALID_INPUT', 'Unsupported chain');
  return parsed as 11155111;
}

export function createVaultUiController(dependencies: ApiDependencies): Record<string, RequestHandler> {
  return {
    pools: handler(async (req, res) => {
      const chainId = chain(req.params, dependencies.config.chainId);
      presentJson(res, 200, { data: await service(dependencies).pools(chainId) });
    }),
    shapes: handler(async (_req, res) => {
      presentJson(res, 200, { data: await service(dependencies).shapes() });
    }),
    previewShape: handler(async (req, res) => {
      presentJson(res, 200, await service(dependencies).shapePreview(ShapePreviewSchema.parse(req.body)));
    }),
    limits: handler(async (req, res) => {
      chain(req.params, dependencies.config.chainId);
      presentJson(res, 200, service(dependencies).limits());
    }),
    validateConfig: handler(async (req, res) => {
      const chainId = chain(req.params, dependencies.config.chainId);
      const parsed = z.strictObject({ config: VaultConfigSchema }).parse(req.body);
      presentJson(res, 200, await service(dependencies).validateConfig(chainId, vaultConfig(parsed.config)));
    }),
    listVaults: handler(async (req, res) => {
      const chainId = chain(req.params, dependencies.config.chainId);
      const query = VaultListQuerySchema.parse(req.query);
      presentJson(
        res,
        200,
        await service(dependencies).listVaults(chainId, {
          cursor: query.cursor ?? null,
          limit: query.limit ?? dependencies.config.defaultPageSize,
          ...(query.strategy ? { strategy: query.strategy } : {}),
          ...(query.poolId ? { poolId: query.poolId } : {}),
          ...(query.wallet ? { wallet: query.wallet as Address } : {}),
          ...(query.search ? { search: query.search } : {}),
          ...(query.sort ? { sort: query.sort } : {}),
          ...(query.direction ? { direction: query.direction } : {}),
        }),
      );
    }),
    vaultDetail: handler(async (req, res) => {
      const params = VaultParamsSchema.parse(req.params);
      const chainId = chain(params, dependencies.config.chainId);
      const query = VaultDetailQuerySchema.parse(req.query);
      presentJson(
        res,
        200,
        await service(dependencies).vaultDetail(
          chainId,
          params.vault as Address,
          query.user as Address | undefined,
        ),
      );
    }),
    bands: handler(async (req, res) => {
      const params = VaultParamsSchema.parse(req.params);
      const chainId = chain(params, dependencies.config.chainId);
      presentJson(res, 200, await service(dependencies).bands(chainId, params.vault as Address));
    }),
    activity: handler(async (req, res) => {
      const params = VaultParamsSchema.parse(req.params);
      const chainId = chain(params, dependencies.config.chainId);
      const query = PageQuerySchema.parse(req.query);
      presentJson(
        res,
        200,
        await service(dependencies).activity(
          chainId,
          params.vault as Address,
          query.cursor ?? null,
          query.limit ?? dependencies.config.defaultPageSize,
        ),
      );
    }),
    history: handler(async (req, res) => {
      const params = VaultParamsSchema.parse(req.params);
      const chainId = chain(params, dependencies.config.chainId);
      presentJson(res, 200, await service(dependencies).history(chainId, params.vault as Address, 'history'));
    }),
    rebalances: handler(async (req, res) => {
      const params = VaultParamsSchema.parse(req.params);
      const chainId = chain(params, dependencies.config.chainId);
      presentJson(
        res,
        200,
        await service(dependencies).history(chainId, params.vault as Address, 'rebalances'),
      );
    }),
    positions: handler(async (req, res) => {
      const params = UserParamsSchema.parse(req.params);
      const chainId = chain(params, dependencies.config.chainId);
      const query = PageQuerySchema.parse(req.query);
      presentJson(
        res,
        200,
        await service(dependencies).positions(
          chainId,
          params.address as Address,
          query.cursor ?? null,
          query.limit ?? dependencies.config.defaultPageSize,
        ),
      );
    }),
    createVault: handler(async (req, res) => {
      const chainId = chain(req.params, dependencies.config.chainId);
      presentJson(res, 200, await service(dependencies).buildCreate(createCommand(chainId, req.body)));
    }),
    quoteDeposit: handler(async (req, res) => {
      const chainId = chain(req.params, dependencies.config.chainId);
      presentJson(res, 200, await service(dependencies).quoteDeposit(depositCommand(chainId, req.body)));
    }),
    buildDeposit: handler(async (req, res) => {
      const chainId = chain(req.params, dependencies.config.chainId);
      presentJson(res, 200, await service(dependencies).buildDeposit(depositCommand(chainId, req.body)));
    }),
    quoteWithdraw: handler(async (req, res) => {
      const chainId = chain(req.params, dependencies.config.chainId);
      presentJson(res, 200, await service(dependencies).quoteWithdraw(withdrawCommand(chainId, req.body)));
    }),
    buildWithdraw: handler(async (req, res) => {
      const chainId = chain(req.params, dependencies.config.chainId);
      presentJson(res, 200, await service(dependencies).buildWithdraw(withdrawCommand(chainId, req.body)));
    }),
    managerUpdate: handler(async (req, res) => {
      const chainId = chain(req.params, dependencies.config.chainId);
      const input = ManagerUpdateSchema.parse(req.body);
      presentJson(
        res,
        200,
        await service(dependencies).buildManagerUpdate({
          chainId,
          vault: input.vault as Address,
          user: input.user as Address,
          config: vaultConfig(input.config),
        }),
      );
    }),
    managerRebalance: handler(async (req, res) => {
      const chainId = chain(req.params, dependencies.config.chainId);
      const input = ManagerRebalanceSchema.parse(req.body);
      presentJson(
        res,
        200,
        await service(dependencies).buildManagerRebalance({
          chainId,
          vault: input.vault as Address,
          user: input.user as Address,
          config: vaultConfig(input.config),
          newCenterTick: input.newCenterTick,
          maxSlippageBps: input.maxSlippageBps,
        }),
      );
    }),
  };
}
