import type { Server } from 'node:http';
import type { Express } from 'express';

export interface ApiServerOptions {
  readonly app: Express;
  readonly host: string;
  readonly port: number;
  readonly shutdownGracePeriodMs?: number;
  readonly closeDependencies: () => Promise<void>;
  readonly log: (
    level: 'debug' | 'info' | 'warn' | 'error',
    event: string,
    detail?: Record<string, unknown>,
  ) => void;
}

/**
 * Starts the HTTP listener and installs one-shot signal handlers that stop
 * accepting requests before closing Redis and PostgreSQL resources.
 *
 * @param options - Application, bind address, logger, and dependency cleanup callback.
 * @returns The Node HTTP server created by Express.
 */
export function startApiServer(options: ApiServerOptions): Server {
  const server = options.app.listen(options.port, options.host, () =>
    options.log('info', 'api_listening', { host: options.host, port: options.port }),
  );
  server.requestTimeout = 10000;
  server.headersTimeout = 8000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 100;
  let shuttingDown = false;
  let dependenciesClosed = false;
  const closeDependencies = async () => {
    if (dependenciesClosed) return;
    dependenciesClosed = true;
    await options.closeDependencies();
  };
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    options.log('info', 'shutdown_started', { signal });
    const deadline = setTimeout(() => {
      options.log('error', 'shutdown_deadline_exceeded', {
        gracePeriodMs: options.shutdownGracePeriodMs ?? 15000,
      });
      server.closeAllConnections();
    }, options.shutdownGracePeriodMs ?? 15000);
    deadline.unref();
    server.close(() => {
      clearTimeout(deadline);
      void closeDependencies()
        .then(() => options.log('info', 'shutdown_complete'))
        .catch(() => {
          process.exitCode = 1;
          options.log('error', 'shutdown_dependency_error');
        });
    });
    server.closeIdleConnections();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  return server;
}
