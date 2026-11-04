import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import type { ApiDependencies } from '../http-context.js';
import { enforceSecurity, rateLimitClientId, validateContentLength } from '../security.js';
import { presentJson } from '../presenters/json.js';

export function requestIdMiddleware(): RequestHandler {
  return (_req, res, next) => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  };
}

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

export function payloadGuard(maxBytes: number): RequestHandler {
  return (req, res, next) => {
    try {
      validateContentLength(req.get('content-length'), maxBytes);
      next();
    } catch (error) {
      const code = error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE'
        ? 'PAYLOAD_TOO_LARGE'
        : 'INVALID_CONTENT_LENGTH';
      presentJson(res, code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { error: code });
    }
  };
}

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
    )
      .then((decision) => {
        for (const [name, value] of Object.entries(decision.headers)) res.setHeader(name, value);
        if (decision.handled) presentJson(res, decision.status ?? 500, decision.body);
        else next();
      })
      .catch(next);
  };
}

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

export function errorHandler(dependencies: ApiDependencies): ErrorRequestHandler {
  return (error: unknown, _req, res, _next) => {
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
    if (
      candidate.code &&
      candidate.status &&
      (candidate.status >= 400 && candidate.status < 500 ||
        candidate.status === 503 && candidate.code === 'PROJECTION_UNAVAILABLE')
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
