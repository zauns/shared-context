import request from 'supertest';
import type { Express } from 'express';
import type { AppConfig } from '../../src/server/config.js';
import { createApp } from '../../src/server/http/server.js';
import { createLogger } from '../../src/server/logger.js';
import { createTestDb } from './db.js';

export function testConfig(): AppConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    dataDir: 'C:\\tmp\\shared-context-test',
    configPath: 'C:\\tmp\\shared-context-test\\config.json',
    dbPath: ':memory:',
    attachmentsDir: 'C:\\tmp\\shared-context-test\\attachments',
    tmpDir: 'C:\\tmp\\shared-context-test\\tmp',
    backupDir: 'C:\\tmp\\shared-context-test\\backups',
    logDir: 'C:\\tmp\\shared-context-test\\logs',
    token: 'test-token',
    logLevel: 'silent',
    backupHour: 3,
    backupRetentionDays: 14,
  };
}

export function createHttpTestApp(): {
  db: ReturnType<typeof createTestDb>;
  app: Express;
  csrfToken: string;
} {
  const db = createTestDb();
  const app = createApp({
    db,
    config: testConfig(),
    logger: createLogger('silent'),
  });
  return { db, app, csrfToken: app.locals.csrfToken as string };
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
