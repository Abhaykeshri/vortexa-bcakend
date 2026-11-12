import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Config } from './config/env.js';

export interface RateLimiter {
  rateLimit(
    scope: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{
    allowed: boolean;
    remaining: number;
  }>;
}

export interface SecurityRequest {
  method: string;
  path: string;
  origin?: string;
  authorization?: string;
  requestedMethod?: string;
  requestedHeaders?: string;
  clientId: string;
}

export interface SecurityDecision {
  handled: boolean;
  status?: number;
  body?: { error: string };
  headers: Record<string, string>;
}

/** Adds the server-generated request identifier to any JSON response shape. */
export function responseWithRequestId(data: unknown, requestId: string): unknown {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))
    throw new Error('Invalid request ID');
  if (data && typeof data === 'object' && !Array.isArray(data))
    return { ...(data as Record<string, unknown>), requestId };
  return { data, requestId };
}

type RoutePolicy = {
  browser: boolean;
  internal: boolean;
  methods?: readonly ('GET' | 'POST')[];
  rateLimit?:
    'network' | 'chain' | 'contracts' | 'vaultRead' | 'vaultEvents' | 'walletPositions' | 'transaction';
};

const policies: Record<string, RoutePolicy> = {
  '/health/live': { browser: false, internal: false },
  '/health/ready': { browser: false, internal: true },
  '/api/v1/network': { browser: true, internal: false, rateLimit: 'network' },
  '/api/v1/chain/status': { browser: true, internal: false, rateLimit: 'chain' },
  '/api/v1/contracts/status': { browser: true, internal: false, rateLimit: 'contracts' },
  '/api/v1/contracts/wiring': { browser: false, internal: true },
};

function policyFor(path: string): RoutePolicy | undefined {
  const exact = policies[path];
  if (exact) return exact;
  if (path === '/api/v1/vaults' || /^\/api\/v1\/vaults\/[^/]+$/.test(path))
    return { browser: false, internal: true, rateLimit: 'vaultRead' };
  if (/^\/api\/v1\/vaults\/[^/]+\/events$/.test(path))
    return { browser: false, internal: true, rateLimit: 'vaultEvents' };
  if (/^\/api\/v1\/wallets\/[^/]+\/positions$/.test(path))
    return { browser: false, internal: true, rateLimit: 'walletPositions' };
  if (path === '/v1/openapi.json' || path === '/v1/shapes')
    return { browser: false, internal: true, methods: ['GET'], rateLimit: 'vaultRead' };
  if (path === '/v1/shapes/preview')
    return { browser: false, internal: true, methods: ['POST'], rateLimit: 'transaction' };
  if (/^\/v1\/chains\/[^/]+\/(?:quotes|tx)\//.test(path))
    return { browser: false, internal: true, methods: ['POST'], rateLimit: 'transaction' };
  if (/^\/v1\/chains\/[^/]+\//.test(path))
    return { browser: false, internal: true, methods: ['GET'], rateLimit: 'vaultRead' };
  return undefined;
}

function reject(status: number, error: string): SecurityDecision {
  return { handled: true, status, body: { error }, headers: {} };
}

function validBearer(authorization: string | undefined, expected: string | undefined): boolean {
  if (!authorization || !expected || !authorization.startsWith('Bearer ')) return false;
  const supplied = authorization.slice('Bearer '.length);
  if (!supplied || supplied.includes(' ')) return false;
  const suppliedDigest = createHash('sha256').update(supplied, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}

/**
 * Selects the rate-limit identity from the socket peer or the validated,
 * rightmost forwarded peer when one trusted reverse proxy is configured.
 */
export function rateLimitClientId(
  remoteAddress: string,
  forwardedFor: string | undefined,
  trustProxy: boolean,
): string {
  if (!trustProxy || !forwardedFor) return remoteAddress;
  const forwardedPeer = forwardedFor.split(',').at(-1)?.trim();
  return forwardedPeer && isIP(forwardedPeer) !== 0 ? forwardedPeer : remoteAddress;
}

function limitFor(config: Config, kind: NonNullable<RoutePolicy['rateLimit']>): number {
  if (kind === 'network') return config.networkRateLimit;
  if (kind === 'chain') return config.chainRateLimit;
  if (kind === 'contracts') return config.contractStatusRateLimit;
  if (kind === 'vaultEvents') return config.vaultEventRateLimit;
  if (kind === 'walletPositions') return config.walletPositionRateLimit;
  if (kind === 'transaction') return config.vaultEventRateLimit;
  return config.vaultReadRateLimit;
}

/** Returns the distributed rate-limit scope and threshold for a registered route. */
export function rateLimitPolicy(
  path: string,
  config: Config,
): { scope: NonNullable<RoutePolicy['rateLimit']>; limit: number } | null {
  const rateLimit = policyFor(path)?.rateLimit;
  return rateLimit ? { scope: rateLimit, limit: limitFor(config, rateLimit) } : null;
}

/** Validates a Content-Length header before body parsing and expensive middleware. */
export function validateContentLength(value: string | undefined, maxBytes: number): number {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid payload limit');
  if (value === undefined) return 0;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('INVALID_CONTENT_LENGTH');
  const size = Number(value);
  if (!Number.isSafeInteger(size)) throw new Error('INVALID_CONTENT_LENGTH');
  if (size > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  return size;
}

/** Applies origin-based CSRF protection only to cookie-authenticated state changes. */
export function csrfAllowsRequest(input: {
  method: string;
  cookieAuthenticated: boolean;
  origin?: string;
  allowedOrigins: readonly string[];
}): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(input.method.toUpperCase())) return true;
  if (!input.cookieAuthenticated) return true;
  return Boolean(input.origin && input.allowedOrigins.includes(input.origin));
}

/**
 * Evaluates route-specific CORS, bearer authentication, preflight, and
 * distributed rate-limit policies before the request reaches a controller.
 */
export async function enforceSecurity(
  request: SecurityRequest,
  config: Config,
  limiter?: RateLimiter,
  options: { skipRateLimit?: boolean } = {},
): Promise<SecurityDecision> {
  const policy = policyFor(request.path);
  if (!policy) return { handled: false, headers: {} };

  if (request.method === 'OPTIONS') {
    if (!policy.browser || !request.origin || !config.corsAllowedOrigins.includes(request.origin))
      return reject(403, 'ORIGIN_NOT_ALLOWED');
    const requestedMethod = request.requestedMethod?.toUpperCase();
    const allowedMethods = policy.methods ?? ['GET'];
    if (!requestedMethod || !allowedMethods.includes(requestedMethod as 'GET' | 'POST'))
      return reject(405, 'METHOD_NOT_ALLOWED');
    const requestedHeaders = (request.requestedHeaders ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (requestedHeaders.some((header) => !['accept', 'content-type'].includes(header)))
      return reject(403, 'HEADER_NOT_ALLOWED');
    return {
      handled: true,
      status: 204,
      headers: {
        ...corsHeaders(request.origin),
        'Access-Control-Allow-Methods': requestedMethod,
        'Access-Control-Allow-Headers': 'Accept, Content-Type',
        'Access-Control-Max-Age': '600',
      },
    };
  }

  if (request.origin) {
    if (!policy.browser || !config.corsAllowedOrigins.includes(request.origin))
      return reject(403, 'ORIGIN_NOT_ALLOWED');
  }

  if (policy.internal && !validBearer(request.authorization, config.internalApiKey))
    return reject(401, 'UNAUTHORIZED');

  const headers = request.origin ? corsHeaders(request.origin) : {};
  if (!policy.rateLimit) return { handled: false, headers };
  if (options.skipRateLimit) return { handled: false, headers };
  if (!limiter) return { ...reject(503, 'SECURITY_DEPENDENCY_UNAVAILABLE'), headers };

  const identity = createHash('sha256').update(request.clientId, 'utf8').digest('hex').slice(0, 32);
  try {
    const result = await limiter.rateLimit(
      `${policy.rateLimit}_${identity}`,
      limitFor(config, policy.rateLimit),
      config.rateLimitWindowSeconds,
    );
    const rateHeaders = {
      ...headers,
      'RateLimit-Limit': String(limitFor(config, policy.rateLimit)),
      'RateLimit-Remaining': String(result.remaining),
      'RateLimit-Reset': String(config.rateLimitWindowSeconds),
    };
    if (!result.allowed)
      return {
        handled: true,
        status: 429,
        body: { error: 'RATE_LIMITED' },
        headers: { ...rateHeaders, 'Retry-After': String(config.rateLimitWindowSeconds) },
      };
    return { handled: false, headers: rateHeaders };
  } catch {
    return { ...reject(503, 'SECURITY_DEPENDENCY_UNAVAILABLE'), headers };
  }
}
