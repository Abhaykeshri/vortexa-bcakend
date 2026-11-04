import type { RequestHandler } from 'express';
import {
  InvalidPaginationCursorError,
  ProjectionUnavailableError,
} from '../../../../packages/application/src/vault-query.service.js';
import type { ApiDependencies } from '../api-dependencies.js';
import { presentJson } from '../presenters/json-response.presenter.js';
import { parseHttpAddress, parsePagination } from '../validators/request.validator.js';

function run(handler: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      if (error instanceof InvalidPaginationCursorError) presentJson(res, 400, { error: 'INVALID_CURSOR' });
      else if (error instanceof ProjectionUnavailableError)
        presentJson(res, 503, { error: 'PROJECTION_UNAVAILABLE' });
      else next(error);
    }
  };
}

function pathAddress(value: string | string[] | undefined): `0x${string}` {
  if (typeof value !== 'string')
    throw Object.assign(new Error('INVALID_ADDRESS'), { status: 400, code: 'INVALID_ADDRESS' });
  return parseHttpAddress(value);
}

export function createVaultQueryController(dependencies: ApiDependencies): {
  listVaults: RequestHandler;
  vaultDetail: RequestHandler;
  vaultEvents: RequestHandler;
  walletPositions: RequestHandler;
} {
  const service = () => {
    if (!dependencies.vaultQueryService)
      throw Object.assign(new Error('PROJECTION_UNAVAILABLE'), {
        status: 503,
        code: 'PROJECTION_UNAVAILABLE',
      });
    return dependencies.vaultQueryService;
  };
  return {
    listVaults: run(async (req, res) => {
      const page = parsePagination(
        req.query,
        dependencies.config.defaultPageSize,
        dependencies.config.maximumPageSize,
      );
      presentJson(res, 200, await service().listVaults(dependencies.config.chainId, page.cursor, page.limit));
    }),
    vaultDetail: run(async (req, res) => {
      const page = parsePagination(req.query, 1, 1);
      if (page.cursor !== null)
        throw Object.assign(new Error('INVALID_CURSOR'), { status: 400, code: 'INVALID_CURSOR' });
      const address = pathAddress(req.params.address);
      const result = await service().vaultDetail(dependencies.config.chainId, address);
      presentJson(res, result.data ? 200 : 404, result.data ? result : { error: 'VAULT_NOT_FOUND' });
    }),
    vaultEvents: run(async (req, res) => {
      const page = parsePagination(
        req.query,
        dependencies.config.defaultPageSize,
        dependencies.config.maximumPageSize,
      );
      const address = pathAddress(req.params.address);
      const result = await service().vaultEvents(
        dependencies.config.chainId,
        address,
        page.cursor,
        page.limit,
      );
      presentJson(res, 200, result);
    }),
    walletPositions: run(async (req, res) => {
      const page = parsePagination(
        req.query,
        dependencies.config.defaultPageSize,
        dependencies.config.maximumPageSize,
      );
      const address = pathAddress(req.params.address);
      const result = await service().walletPositions(
        dependencies.config.chainId,
        address,
        page.cursor,
        page.limit,
      );
      presentJson(res, 200, result);
    }),
  };
}
