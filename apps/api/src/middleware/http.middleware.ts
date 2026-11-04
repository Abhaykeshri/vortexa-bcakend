import { createHash, randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { rateLimit as expressRateLimit, type Options, type Store } from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import type { ApiDependencies } from '../api-dependencies.js';
import {
  enforceSecurity,
  rateLimitClientId,
  rateLimitPolicy,
  validateContentLength,
  type RateLimiter,
} from '../http-security.js';
import { presentJson } from '../presenters/json-response.presenter.js';

/** Creates a non-user-controlled UUID for response correlation and safe logging. */
export function requestIdMiddleware(): RequestHandler {
  return (_req, res, next) => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  };
}

/**
 * Emits one structured completion event per request without logging query
 * values, authorization headers, request bodies, or client credentials.
 */
export function requestLoggingMiddleware(dependencies: ApiDependencies): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      dependencies.log(
        res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        'http_request_completed',
        {
          requestId: String(res.locals.requestId ?? 'unknown'),
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        },
      );
    });
    next();
  };
}

/** Configures Helmet with an API-only CSP and production HSTS policy. */
export function helmetMiddleware(production: boolean): RequestHandler {
  return helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    frameguard: { action: 'deny' },
    hsts: production ? { maxAge: 31536000, includeSubDomains: false } : false,
    referrerPolicy: { policy: 'no-referrer' },
    xXssProtection: true,
  });
}

/** Rejects malformed or oversized Content-Length values before body parsing. */
export function payloadGuard(maxBytes: number): RequestHandler {
  return (req, res, next) => {
    try {
      validateContentLength(req.get('content-length'), maxBytes);
      next();
    } catch (error) {
      const code =
        error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE'
          ? 'PAYLOAD_TOO_LARGE'
          : 'INVALID_CONTENT_LENGTH';
      presentJson(res, code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { error: code });
    }
  };
}

/** Adapts the framework-neutral security policy to the Express middleware contract. */
export function securityMiddleware(dependencies: ApiDependencies): RequestHandler {
  const { config, limiter } = dependencies;
  return (req, res, next) => {
    const forwarded = req.headers['x-forwarded-for'];
    const forwardedFor = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
    void enforceSecurity(
      {
        method: req.method,
        path: req.path,
        clientId: rateLimitClientId(req.socket.remoteAddress ?? 'unknown', forwardedFor, config.trustProxy),
        ...(req.get('origin') ? { origin: req.get('origin')! } : {}),
        ...(req.get('authorization') ? { authorization: req.get('authorization')! } : {}),
        ...(req.get('access-control-request-method')
          ? { requestedMethod: req.get('access-control-request-method')! }
          : {}),
        ...(req.get('access-control-request-headers')
          ? { requestedHeaders: req.get('access-control-request-headers')! }
          : {}),
      },
      config,
      limiter,
      { skipRateLimit: true },
    )
      .then((decision) => {
        for (const [name, value] of Object.entries(decision.headers)) res.setHeader(name, value);
        if (decision.handled) presentJson(res, decision.status ?? 500, decision.body);
        else next();
      })
      .catch(next);
  };
}

class SecurityDependencyUnavailableError extends Error {
  constructor() {
    super('Security dependency unavailable');
    this.name = 'SecurityDependencyUnavailableError';
  }
}

class DistributedRateLimitStore implements Store {
  private windowSeconds = 60;

  constructor(private readonly limiter: RateLimiter) {}

  init(options: Options): void {
    this.windowSeconds = Math.max(1, Math.ceil(options.windowMs / 1000));
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    const counterCeiling = 1_000_000_000;
    try {
      const result = await this.limiter.rateLimit(`express_${key}`, counterCeiling, this.windowSeconds);
      return {
        totalHits: counterCeiling - result.remaining,
        resetTime: new Date(Date.now() + this.windowSeconds * 1000),
      };
    } catch {
      throw new SecurityDependencyUnavailableError();
    }
  }

  decrement(): void {}

  resetKey(): void {}
}

/**
 * Enforces route-specific limits through express-rate-limit and the shared Redis counter.
 * Missing Redis fails protected routes closed instead of falling back to process memory.
 */
export function distributedRateLimitMiddleware(dependencies: ApiDependencies): RequestHandler {
  const { config, limiter } = dependencies;
  if (!limiter)
    return (req, res, next) => {
      if (rateLimitPolicy(req.path, config))
        presentJson(res, 503, { error: 'SECURITY_DEPENDENCY_UNAVAILABLE' });
      else next();
    };
  return expressRateLimit({
    windowMs: config.rateLimitWindowSeconds * 1000,
    limit: (req) => rateLimitPolicy(req.path, config)?.limit ?? config.globalRateLimit,
    skip: (req) => rateLimitPolicy(req.path, config) === null,
    keyGenerator: (req) => {
      const forwarded = req.headers['x-forwarded-for'];
      const forwardedFor = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
      const client = rateLimitClientId(
        req.socket.remoteAddress ?? 'unknown',
        forwardedFor,
        config.trustProxy,
      );
      const scope = rateLimitPolicy(req.path, config)?.scope ?? 'unscoped';
      return `${scope}_${createHash('sha256').update(client, 'utf8').digest('hex').slice(0, 32)}`;
    },
    store: new DistributedRateLimitStore(limiter),
    standardHeaders: 'draft-6',
    legacyHeaders: false,
    passOnStoreError: false,
    handler: (_req, res) => presentJson(res, 429, { error: 'RATE_LIMITED' }),
  });
}

/** Adds CORS headers only for exact configured origins accepted by the security policy. */
export function corsMiddleware(allowedOrigins: readonly string[]): RequestHandler {
  return cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.includes(origin));
    },
    methods: ['GET'],
    allowedHeaders: ['Accept', 'Content-Type'],
    credentials: false,
    preflightContinue: true,
    maxAge: 600,
  });
}

export function methodGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET') next();
  else presentJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
}

export function notFoundHandler(_req: Request, res: Response): void {
  presentJson(res, 404, { error: 'NOT_FOUND' });
}

/** Maps parser, validation, and upstream failures to sanitized JSON responses. */
export function errorHandler(dependencies: ApiDependencies): ErrorRequestHandler {
  return (error: unknown, _req, res, _next) => {
    void _next;
    if (res.headersSent) return;
    const candidate = error as { status?: number; statusCode?: number; code?: string; type?: string };
    if (candidate.type === 'entity.too.large') {
      presentJson(res, 413, { error: 'PAYLOAD_TOO_LARGE' });
      return;
    }
    if (candidate.type === 'entity.parse.failed') {
      presentJson(res, 400, { error: 'INVALID_JSON' });
      return;
    }
    if (error instanceof SecurityDependencyUnavailableError) {
      presentJson(res, 503, { error: 'SECURITY_DEPENDENCY_UNAVAILABLE' });
      return;
    }
    if (
      candidate.code &&
      candidate.status &&
      ((candidate.status >= 400 && candidate.status < 500) ||
        (candidate.status === 503 && candidate.code === 'PROJECTION_UNAVAILABLE'))
    ) {
      presentJson(res, candidate.status, { error: candidate.code });
      return;
    }
    dependencies.log('error', 'request_failed', {
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    presentJson(res, 503, { error: 'UPSTREAM_UNAVAILABLE' });
  };
}
