import express, { type Express } from 'express';
import type { ApiDependencies } from './http-context.js';
import { corsMiddleware, errorHandler, helmetMiddleware, methodGuard, notFoundHandler, payloadGuard, requestIdMiddleware, securityMiddleware } from './middleware/request.js';
import { createApiRouter } from './routes/index.js';

export function createApp(dependencies: ApiDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('json escape', true);
  app.set('trust proxy', false);
  app.use(requestIdMiddleware());
  app.use(helmetMiddleware(dependencies.config.nodeEnv === 'production'));
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(payloadGuard(dependencies.config.maxRequestBodyBytes));
  app.use(securityMiddleware(dependencies));
  app.use(corsMiddleware(dependencies.config.corsAllowedOrigins));
  app.use(express.json({ limit: dependencies.config.maxRequestBodyBytes, strict: true }));
  app.use(methodGuard);
  app.use(createApiRouter(dependencies));
  app.use(notFoundHandler);
  app.use(errorHandler(dependencies));
  return app;
}
