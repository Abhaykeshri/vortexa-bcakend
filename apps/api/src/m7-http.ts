import { DomainError } from '../../../packages/domain/src/errors.js';
import { parseAddress } from '../../../packages/domain/src/validation.js';
import type { ChainId } from '../../../packages/domain/src/types.js';
import {
  InvalidPaginationCursorError,
  M7QueryService,
  ProjectionUnavailableError,
} from '../../../packages/application/src/m7-queries.js';

export interface M7HttpResponse {
  status: number;
  body: unknown;
}

function pagination(url: URL, defaultLimit: number, maxLimit: number) {
  const allowed = new Set(['chainId', 'cursor', 'limit']);
  for (const key of url.searchParams.keys()) if (!allowed.has(key)) throw new Error('INVALID_QUERY');
  if (url.searchParams.getAll('cursor').length > 1 || url.searchParams.getAll('limit').length > 1)
    throw new Error('INVALID_QUERY');
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? defaultLimit : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) throw new Error('INVALID_LIMIT');
  const cursor = url.searchParams.get('cursor');
  if (cursor !== null && (cursor.length < 1 || cursor.length > 2048)) throw new Error('INVALID_CURSOR');
  return { limit, cursor };
}

function address(value: string) {
  return parseAddress(value).toLowerCase() as `0x${string}`;
}

export async function handleM7HttpRequest(input: {
  url: URL;
  path: string;
  chainId: ChainId;
  service: M7QueryService;
  defaultLimit: number;
  maxLimit: number;
}): Promise<M7HttpResponse | null> {
  try {
    if (input.path === '/api/v1/vaults') {
      const page = pagination(input.url, input.defaultLimit, input.maxLimit);
      return {
        status: 200,
        body: await input.service.listVaults(input.chainId, page.cursor, page.limit),
      };
    }
    const eventMatch = input.path.match(/^\/api\/v1\/vaults\/([^/]+)\/events$/);
    if (eventMatch) {
      const vault = address(decodeURIComponent(eventMatch[1]!));
      const page = pagination(input.url, input.defaultLimit, input.maxLimit);
      return {
        status: 200,
        body: await input.service.vaultEvents(input.chainId, vault, page.cursor, page.limit),
      };
    }
    const vaultMatch = input.path.match(/^\/api\/v1\/vaults\/([^/]+)$/);
    if (vaultMatch) {
      const vault = address(decodeURIComponent(vaultMatch[1]!));
      const page = pagination(input.url, 1, 1);
      if (page.cursor !== null) throw new Error('INVALID_CURSOR');
      const result = await input.service.vaultDetail(input.chainId, vault);
      return result.data
        ? { status: 200, body: result }
        : { status: 404, body: { error: 'VAULT_NOT_FOUND' } };
    }
    const walletMatch = input.path.match(/^\/api\/v1\/wallets\/([^/]+)\/positions$/);
    if (walletMatch) {
      const wallet = address(decodeURIComponent(walletMatch[1]!));
      const page = pagination(input.url, input.defaultLimit, input.maxLimit);
      return {
        status: 200,
        body: await input.service.walletPositions(input.chainId, wallet, page.cursor, page.limit),
      };
    }
    return null;
  } catch (error) {
    if (error instanceof DomainError) return { status: 400, body: { error: 'INVALID_ADDRESS' } };
    if (
      error instanceof InvalidPaginationCursorError ||
      (error instanceof Error && error.message === 'INVALID_CURSOR')
    )
      return { status: 400, body: { error: 'INVALID_CURSOR' } };
    if (error instanceof ProjectionUnavailableError)
      return { status: 503, body: { error: 'PROJECTION_UNAVAILABLE' } };
    if (error instanceof URIError) return { status: 400, body: { error: 'INVALID_ADDRESS' } };
    if (error instanceof Error && error.message === 'INVALID_LIMIT')
      return { status: 400, body: { error: 'INVALID_LIMIT' } };
    if (error instanceof Error && error.message === 'INVALID_QUERY')
      return { status: 400, body: { error: 'INVALID_QUERY' } };
    throw error;
  }
}
