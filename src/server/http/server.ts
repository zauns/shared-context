import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/connection.js';
import type { Logger } from '../logger.js';

const VERSION = '0.1.0';

export interface AppDependencies {
  db: Database;
  config: AppConfig;
  logger: Logger;
  webDir?: string;
}

export function createApp({ db, config, logger, webDir }: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_request, response) => {
    const journal = db.prepare('PRAGMA journal_mode').get() as
      | { journal_mode: string }
      | undefined;
    response.json({
      ok: true,
      version: VERSION,
      uptime_seconds: process.uptime(),
      db: {
        open: true,
        journal_mode: journal?.journal_mode ?? 'unknown',
      },
    });
  });

  if (webDir && fs.existsSync(path.join(webDir, 'index.html'))) {
    app.use(express.static(webDir));
    app.use((request: Request, response: Response, next: NextFunction) => {
      if (
        request.method !== 'GET' ||
        request.path.startsWith('/api') ||
        request.path === '/mcp' ||
        request.path === '/healthz'
      ) {
        next();
        return;
      }
      response.sendFile(path.join(webDir, 'index.html'));
    });
  }

  app.use((request: Request, response: Response) => {
    response.status(404).json({
      ok: false,
      error: { code: 'not_found', message: `No route for ${request.method} ${request.path}` },
    });
  });

  app.use(
    (error: unknown, request: Request, response: Response, _next: NextFunction) => {
      logger.error({ err: error, method: request.method, path: request.path }, 'request failed');
      response.status(500).json({
        ok: false,
        error: { code: 'internal_error', message: 'Internal server error' },
      });
    },
  );

  // Keep the config referenced so future routes can use it without changing the signature.
  void config;

  return app;
}

export function listen(app: Express, config: AppConfig): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => resolve(server));
    server.once('error', reject);
  });
}
