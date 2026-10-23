import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { loadConfig, ensureDataDirs, cleanTmpDir, type AppConfig } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { openDatabase, closeDatabase, type Database } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { createApp, listen } from './http/server.js';
import { startBackupScheduler } from './services/backups.js';

export interface StartedServer {
  app: ReturnType<typeof createApp>;
  server: Server;
  db: Database;
  config: AppConfig;
  logger: Logger;
}

export async function startServer(overrides: Partial<AppConfig> = {}): Promise<StartedServer> {
  const config = loadConfig(overrides);
  ensureDataDirs(config);
  cleanTmpDir(config);
  const logger = createLogger(config.logLevel);
  const db = openDatabase(config.dbPath);
  const applied = migrate(db);
  logger.info({ applied, dbPath: config.dbPath }, 'database ready');

  const webDir = fileURLToPath(new URL('../web', import.meta.url));
  const app = createApp({ db, config, logger, webDir });
  const server = await listen(app, config);

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  logger.info({ host: config.host, port }, 'shared-context listening');
  const backupScheduler = startBackupScheduler(db, config, logger);

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    backupScheduler.stop();
    server.close(() => {
      closeDatabase(db);
      logger.info('shutdown complete');
      process.exit(0);
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  return { app, server, db, config, logger };
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  startServer().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
