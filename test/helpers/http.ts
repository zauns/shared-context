import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import type { AppConfig } from '../../src/server/config.js';
import { ensureDataDirs } from '../../src/server/config.js';
import { createApp } from '../../src/server/http/server.js';
import { createLogger } from '../../src/server/logger.js';
import { createTestDb } from './db.js';

export function testConfig(): AppConfig {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-context-test-'));
  return {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    configPath: path.join(dataDir, 'config.json'),
    dbPath: ':memory:',
    attachmentsDir: path.join(dataDir, 'data', 'attachments'),
    tmpDir: path.join(dataDir, 'data', 'tmp'),
    backupDir: path.join(dataDir, 'backups'),
    logDir: path.join(dataDir, 'logs'),
    token: 'test-token',
    logLevel: 'silent',
    backupHour: 3,
    backupRetentionDays: 14,
  };
}

export function createHttpTestApp(): {
  db: ReturnType<typeof createTestDb>;
  app: Express;
  config: AppConfig;
  csrfToken: string;
} {
  const db = createTestDb();
  const config = testConfig();
  ensureDataDirs(config);
  const app = createApp({
    db,
    config,
    logger: createLogger('silent'),
  });
  return { db, app, config, csrfToken: app.locals.csrfToken as string };
}

export async function setupProject(
  app: Express,
  csrfToken: string,
  projectKey = 'SHC',
): Promise<void> {
  const response = await request(app)
    .post('/api/setup')
    .set('X-CSRF-Token', csrfToken)
    .send({
      owner_name: 'Owner',
      project_key: projectKey,
      project_name: 'Shared Context',
    });
  if (response.status !== 200) {
    throw new Error(`setup failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
}
