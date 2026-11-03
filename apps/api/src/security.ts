import { createHash, timingSafeEqual } from 'node:crypto';
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

type RoutePolicy = {
  browser: boolean;
  internal: boolean;
  rateLimit?: 'network' | 'chain' | 'contracts';
};

const policies: Record<string, RoutePolicy> = {
  '/health/live': { browser: false, internal: false },
  '/health/ready': { browser: false, internal: true },
  '/api/v1/network': { browser: true, internal: false, rateLimit: 'network' },
  '/api/v1/chain/status': { browser: true, internal: false, rateLimit: 'chain' },
  '/api/v1/contracts/status': { browser: true, internal: false, rateLimit: 'contracts' },
  '/api/v1/contracts/wiring': { browser: false, internal: true },
};

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

function limitFor(config: Config, kind: NonNullable<RoutePolicy['rateLimit']>): number {
  if (kind === 'network') return config.networkRateLimit;
  if (kind === 'chain') return config.chainRateLimit;
  return config.contractStatusRateLimit;
}

export async function enforceSecurity(
  request: SecurityRequest,
  config: Config,
  limiter?: RateLimiter,
): Promise<SecurityDecision> {
  const policy = policies[request.path];
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
