import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHttpTestApp, setupProject } from '../helpers/http.js';

describe('HTTP concurrency', () => {
  it('allows exactly one winner among 20 updates at the same revision', async () => {
    const { app, csrfToken } = createHttpTestApp();
    await setupProject(app, csrfToken);
    const created = await request(app)
      .post('/api/issues')
      .set('X-CSRF-Token', csrfToken)
      .send({ project: 'SHC', title: 'Contended issue' });
    const issue = created.body.issue;

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        request(app)
          .patch('/api/issues/SHC-1')
          .set('X-CSRF-Token', csrfToken)
          .send({ expected_rev: issue.rev, title: `Title ${index}` }),
      ),
    );

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(19);
    const final = await request(app).get('/api/issues/SHC-1');
    expect(final.body.issue.rev).toBe(2);
  });

  it('allows exactly one winner among 20 concurrent claims', async () => {
    const { app, db, csrfToken } = createHttpTestApp();
    await setupProject(app, csrfToken);
    await request(app)
      .post('/api/issues')
      .set('X-CSRF-Token', csrfToken)
      .send({ project: 'SHC', title: 'Claim race' });

    const { identifyActor } = await import('../../src/server/domain/actors.js');
    const agents = Array.from({ length: 20 }, (_, index) =>
      identifyActor(db, { name: `agent-${index}`, kind: 'agent' }),
    );

    const responses = await Promise.all(
      agents.map((agent) =>
        request(app)
          .post('/api/issues/SHC-1/claim')
          .set('X-CSRF-Token', csrfToken)
          .set('X-Actor', agent.name)
          .send({}),
      ),
    );

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(19);
    const final = await request(app).get('/api/issues/SHC-1');
    expect(final.body.issue.assignee).not.toBeNull();
  });
});
