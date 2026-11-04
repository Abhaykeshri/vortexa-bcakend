import { parseAddress } from '../../../../packages/domain/src/validation.js';

export function validateRequestedChain(value: unknown, activeChainId: number): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || Number(value) !== activeChainId)
    throw Object.assign(new Error('INVALID_CHAIN_ID'), { status: 400, code: 'INVALID_CHAIN_ID' });
}

export function parsePagination(
  query: Record<string, unknown>,
  defaultLimit: number,
  maxLimit: number,
): { cursor: string | null; limit: number } {
  const allowed = new Set(['chainId', 'cursor', 'limit']);
  if (Object.keys(query).some((key) => !allowed.has(key)))
    throw Object.assign(new Error('INVALID_QUERY'), { status: 400, code: 'INVALID_QUERY' });
  const cursorValue = query.cursor;
  const limitValue = query.limit;
  if (Array.isArray(cursorValue) || Array.isArray(limitValue))
    throw Object.assign(new Error('INVALID_QUERY'), { status: 400, code: 'INVALID_QUERY' });
  if (cursorValue !== undefined && (typeof cursorValue !== 'string' || cursorValue.length < 1 || cursorValue.length > 2048))
    throw Object.assign(new Error('INVALID_CURSOR'), { status: 400, code: 'INVALID_CURSOR' });
  const limit = limitValue === undefined ? defaultLimit : Number(limitValue);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit)
    throw Object.assign(new Error('INVALID_LIMIT'), { status: 400, code: 'INVALID_LIMIT' });
  return { cursor: typeof cursorValue === 'string' ? cursorValue : null, limit };
}

export function parseHttpAddress(value: string): `0x${string}` {
  try {
    return parseAddress(decodeURIComponent(value)).toLowerCase() as `0x${string}`;
  } catch {
    throw Object.assign(new Error('INVALID_ADDRESS'), { status: 400, code: 'INVALID_ADDRESS' });
  }
}
