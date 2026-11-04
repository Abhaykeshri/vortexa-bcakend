import type { RequestHandler } from 'express';
import { InvalidPaginationCursorError, ProjectionUnavailableError } from '../../../../packages/application/src/m7-queries.js';
import type { ApiDependencies } from '../http-context.js';
import { presentJson } from '../presenters/json.js';
import { parseHttpAddress, parsePagination } from '../validators/http.js';

function run(handler: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      if (error instanceof InvalidPaginationCursorError)
        presentJson(res, 400, { error: 'INVALID_CURSOR' });
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

export function m7Controller(dependencies: ApiDependencies): {
  listVaults: RequestHandler;
  vaultDetail: RequestHandler;
  vaultEvents: RequestHandler;
  walletPositions: RequestHandler;
} {
  const service = () => {
    if (!dependencies.m7Service)
      throw Object.assign(new Error('PROJECTION_UNAVAILABLE'), {
        status: 503,
        code: 'PROJECTION_UNAVAILABLE',
      });
    return dependencies.m7Service;
  };
  return {
    listVaults: run(async (req, res) => {
      const page = parsePagination(req.query, dependencies.config.m7PageDefault, dependencies.config.m7PageMax);
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
      const page = parsePagination(req.query, dependencies.config.m7PageDefault, dependencies.config.m7PageMax);
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
      const page = parsePagination(req.query, dependencies.config.m7PageDefault, dependencies.config.m7PageMax);
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
