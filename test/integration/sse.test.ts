import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { currentActivityCursor } from '../../src/server/db/repositories/activities.js';
import { waitForChange } from '../../src/server/services/change-bus.js';
import { createHttpTestApp, setupProject } from '../helpers/http.js';

describe('SSE and change feed', () => {
  it('replays an Activity event over SSE', async () => {
    const { app, db, csrfToken } = createHttpTestApp();
    await setupProject(app, csrfToken);
    await request(app)
      .post('/api/issues')
      .set('X-CSRF-Token', csrfToken)
      .send({ project: 'SHC', title: 'SSE issue' });

    const since = currentActivityCursor(db) - 1;
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const controller = new AbortController();

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/events?since=${since}`,
        { signal: controller.signal },
      );
      expect(response.status).toBe(200);
      expect(response.body).not.toBeNull();
      const reader = response.body!.getReader();
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      expect(text).toContain('event: issue.created');
      expect(text).toContain('SHC-1');
      await reader.cancel();
    } finally {
      controller.abort();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('wakes a wait_for_change waiter after an HTTP mutation', async () => {
    const { app, db, csrfToken } = createHttpTestApp();
    await setupProject(app, csrfToken);
    const since = currentActivityCursor(db);
    const bus = app.locals.changeBus;
    const waiting = waitForChange(db, bus, { since, timeoutMs: 2_000 });

    await request(app)
      .post('/api/issues')
      .set('X-CSRF-Token', csrfToken)
      .send({ project: 'SHC', title: 'Wake up' });

    const result = await waiting;
    expect(result.timed_out).toBe(false);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0]?.type).toBe('issue.created');
  });
});
