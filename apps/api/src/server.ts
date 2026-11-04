import type { Server } from 'node:http';
import type { Express } from 'express';

export interface ApiServerOptions {
  readonly app: Express;
  readonly host: string;
  readonly port: number;
  readonly closeDependencies: () => Promise<void>;
  readonly log: (level: 'debug' | 'info' | 'warn' | 'error', event: string, detail?: Record<string, unknown>) => void;
}

export function startApiServer(options: ApiServerOptions): Server {
  const server = options.app.listen(options.port, options.host, () =>
    options.log('info', 'api_listening', { host: options.host, port: options.port }),
  );
  server.requestTimeout = 10000;
  server.headersTimeout = 8000;
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    options.log('info', 'shutdown_started', { signal });
    server.close(() => {
      void options.closeDependencies().then(() => options.log('info', 'shutdown_complete')).catch(() => {
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
