import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/http/server.js';
import { createLogger } from '../../src/server/logger.js';
import { openDatabase } from '../../src/server/db/connection.js';
import { migrate } from '../../src/server/db/migrate.js';
import type { AppConfig } from '../../src/server/config.js';

describe('health endpoint', () => {
  it('reports the database as open', async () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const app = createApp({
      db,
      config: { port: 0 } as AppConfig,
      logger: createLogger('silent'),
    });
    const response = await request(app).get('/healthz');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.db.open).toBe(true);
    expect(typeof response.body.db.journal_mode).toBe('string');
    db.close();
  });
});
