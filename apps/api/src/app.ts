import express, { type Express } from 'express';
import type { ApiDependencies } from './api-dependencies.js';
import {
  corsMiddleware,
  distributedRateLimitMiddleware,
  errorHandler,
  helmetMiddleware,
  methodGuard,
  notFoundHandler,
  payloadGuard,
  requestLoggingMiddleware,
  requestIdMiddleware,
  securityMiddleware,
} from './middleware/http.middleware.js';
import { createApiRouter } from './routes/index.js';

/**
 * Builds the complete Express application without opening a network socket.
 * Infrastructure is supplied through {@link ApiDependencies}, which keeps HTTP
 * tests deterministic and prevents controllers from constructing adapters.
 */
export function createApp(dependencies: ApiDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('json escape', true);
  app.set('trust proxy', false);
  app.use(requestIdMiddleware());
  app.use(requestLoggingMiddleware(dependencies));
  app.use(helmetMiddleware(dependencies.config.nodeEnv === 'production'));
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(payloadGuard(dependencies.config.maxRequestBodyBytes));
  app.use(securityMiddleware(dependencies));
  app.use(distributedRateLimitMiddleware(dependencies));
  app.use(corsMiddleware(dependencies.config.corsAllowedOrigins));
  app.use(express.json({ limit: dependencies.config.maxRequestBodyBytes, strict: true }));
  app.use(methodGuard);
  app.use(createApiRouter(dependencies));
  app.use(notFoundHandler);
  app.use(errorHandler(dependencies));
  return app;
}
