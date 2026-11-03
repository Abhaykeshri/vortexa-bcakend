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

export function httpSecurityHeaders(production: boolean): Record<string, string> {
  return {
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Origin-Agent-Cluster': '?1',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-DNS-Prefetch-Control': 'off',
    'X-Download-Options': 'noopen',
    'X-Frame-Options': 'DENY',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'X-XSS-Protection': '0',
    ...(production ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
    'Content-Type': 'application/json; charset=utf-8',
  };
}

export function serializeJsonResponse(data: unknown): string {
  const serialized = JSON.stringify(data);
  if (serialized === undefined) throw new TypeError('Response data is not JSON serializable');
  // Preserve the parsed JSON value while preventing markup/script delimiters
  // from appearing literally if a downstream proxy ever mislabels the MIME type.
  return serialized.replace(/[<>&\u2028\u2029]/g, (character) => {
    const escapes: Record<string, string> = {
      '<': '\\u003c',
      '>': '\\u003e',
      '&': '\\u0026',
      '\u2028': '\\u2028',
      '\u2029': '\\u2029',
    };
    return escapes[character]!;
  });
}

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
  rateLimit?: 'network' | 'chain' | 'contracts' | 'm7Read' | 'm7Events' | 'm7Wallet';
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
    return { browser: true, internal: false, rateLimit: 'm7Read' };
  if (/^\/api\/v1\/vaults\/[^/]+\/events$/.test(path))
    return { browser: true, internal: false, rateLimit: 'm7Events' };
  if (/^\/api\/v1\/wallets\/[^/]+\/positions$/.test(path))
    return { browser: true, internal: false, rateLimit: 'm7Wallet' };
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
  if (kind === 'm7Events') return config.m7EventRateLimit;
  if (kind === 'm7Wallet') return config.m7WalletRateLimit;
  return config.m7ReadRateLimit;
}

export function validateContentLength(value: string | undefined, maxBytes: number): number {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid payload limit');
  if (value === undefined) return 0;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('INVALID_CONTENT_LENGTH');
  const size = Number(value);
  if (!Number.isSafeInteger(size)) throw new Error('INVALID_CONTENT_LENGTH');
  if (size > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  return size;
}

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

export async function enforceSecurity(
  request: SecurityRequest,
  config: Config,
  limiter?: RateLimiter,
): Promise<SecurityDecision> {
  const policy = policyFor(request.path);
  if (!policy) return { handled: false, headers: {} };

  if (request.method === 'OPTIONS') {
    if (!policy.browser || !request.origin || !config.corsAllowedOrigins.includes(request.origin))
      return reject(403, 'ORIGIN_NOT_ALLOWED');
    if (request.requestedMethod !== 'GET') return reject(405, 'METHOD_NOT_ALLOWED');
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
        'Access-Control-Allow-Methods': 'GET',
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
