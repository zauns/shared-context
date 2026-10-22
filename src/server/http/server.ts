import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import express, { type Express } from 'express';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/connection.js';
import type { Logger } from '../logger.js';
import { ChangeBus } from '../services/change-bus.js';
import { createApiRouter } from './api.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { hostGuard } from './middleware.js';

const VERSION = '0.1.0';

export interface AppDependencies {
  db: Database;
  config: AppConfig;
  logger: Logger;
  webDir?: string;
  bus?: ChangeBus;
  csrfToken?: string;
}

export function createApp({
  db,
  config,
  logger,
  webDir,
  bus = new ChangeBus(),
  csrfToken = randomBytes(24).toString('base64url'),
}: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.locals.changeBus = bus;
  app.locals.csrfToken = csrfToken;

  app.use(hostGuard());
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

  app.use(
    '/api',
    createApiRouter({ db, config, logger, bus, csrfToken }),
  );

  if (webDir && fs.existsSync(path.join(webDir, 'index.html'))) {
    app.use(express.static(webDir));
    app.use((request, response, next) => {
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

  app.use(notFoundHandler());
  app.use(errorHandler(logger));

  return app;
}

export function listen(app: Express, config: AppConfig): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, config.host, () => resolve(server));
    server.once('error', reject);
  });
}
