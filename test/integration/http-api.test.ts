import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHttpTestApp, setupProject } from '../helpers/http.js';

describe('HTTP API', () => {
  it('reports setup state, config, and creates the owner/project', async () => {
    const { app, csrfToken } = createHttpTestApp();
    const before = await request(app).get('/api/setup');
    expect(before.status).toBe(200);
    expect(before.body.required).toBe(true);

    const config = await request(app).get('/api/config');
    expect(config.status).toBe(200);
    expect(config.body.setup_required).toBe(true);
    expect(config.body.token).toBeUndefined();

    await setupProject(app, csrfToken);
    const after = await request(app).get('/api/setup');
    expect(after.body.required).toBe(false);
    const projects = await request(app).get('/api/projects');
    expect(projects.body.items).toHaveLength(1);
    expect(projects.body.items[0].key).toBe('SHC');
  });

  it('creates, reads, boards, updates, and filters Issues', async () => {
    const { app, csrfToken } = createHttpTestApp();
    await setupProject(app, csrfToken);

    const created = await request(app)
      .post('/api/issues')
      .set('X-CSRF-Token', csrfToken)
      .send({ project: 'SHC', title: 'First issue', priority: 'high' });
    expect(created.status).toBe(201);
    const issue = created.body.issue;
    expect(issue.key).toBe('SHC-1');
    expect(issue.rev).toBe(1);

    const detail = await request(app).get('/api/issues/SHC-1');
    expect(detail.status).toBe(200);
    expect(detail.body.issue.title).toBe('First issue');

    const board = await request(app).get('/api/projects/SHC/board');
    expect(board.status).toBe(200);
    expect(board.body.columns).toHaveLength(6);
    expect(board.body.columns.find((column: { stage: string }) => column.stage === 'backlog').count).toBe(1);

    const updated = await request(app)
      .patch('/api/issues/SHC-1')
      .set('X-CSRF-Token', csrfToken)
      .send({ expected_rev: issue.rev, title: 'Updated issue' });
    expect(updated.status).toBe(200);
    expect(updated.body.issue.rev).toBe(2);

    const stale = await request(app)
      .patch('/api/issues/SHC-1')
      .set('X-CSRF-Token', csrfToken)
      .send({ expected_rev: issue.rev, title: 'Stale' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('conflict');
    expect(stale.body.issue.rev).toBe(2);

    const search = await request(app).get('/api/search?q=Updated');
    expect(search.status).toBe(200);
    expect(search.body.items).toHaveLength(1);
    expect(search.body.items[0].issue.key).toBe('SHC-1');

    const filtered = await request(app).get('/api/issues?project=SHC&priorities=high');
    expect(filtered.status).toBe(200);
    expect(filtered.body.items).toHaveLength(1);
  });

  it('moves, claims, blocks, unblocks, and releases an Issue', async () => {
    const { app, csrfToken } = createHttpTestApp();
    await setupProject(app, csrfToken);
    const created = await request(app)
      .post('/api/issues')
      .set('X-CSRF-Token', csrfToken)
      .send({ project: 'SHC', title: 'Workflow issue' });
    let issue = created.body.issue;

    const moved = await request(app)
      .post('/api/issues/SHC-1/move')
      .set('X-CSRF-Token', csrfToken)
      .send({ expected_rev: issue.rev, stage: 'todo' });
    expect(moved.status).toBe(200);
    expect(moved.body.issue.stage).toBe('todo');

    const claimed = await request(app)
      .post('/api/issues/SHC-1/claim')
      .set('X-CSRF-Token', csrfToken)
      .send({});
    expect(claimed.status).toBe(200);
    expect(claimed.body.claimed).toBe(true);
    expect(claimed.body.issue.stage).toBe('in_progress');
    issue = claimed.body.issue;

    const blocked = await request(app)
      .post('/api/issues/SHC-1/block')
      .set('X-CSRF-Token', csrfToken)
      .send({ expected_rev: issue.rev, reason: 'Waiting on API key' });
    expect(blocked.status).toBe(200);
    expect(blocked.body.issue.blocked).toBe(true);
    expect(blocked.body.issue.stage).toBe('in_progress');
    issue = blocked.body.issue;

    const unblocked = await request(app)
      .post('/api/issues/SHC-1/unblock')
      .set('X-CSRF-Token', csrfToken)
      .send({ expected_rev: issue.rev });
    expect(unblocked.status).toBe(200);
    expect(unblocked.body.issue.blocked).toBe(false);

    const released = await request(app)
      .post('/api/issues/SHC-1/release')
      .set('X-CSRF-Token', csrfToken)
      .send({});
    expect(released.status).toBe(200);
    expect(released.body.released).toBe(true);
    expect(released.body.issue.assignee).toBeNull();
  });

  it('adds comments and links and exposes activity', async () => {
    const { app, csrfToken } = createHttpTestApp();
    await setupProject(app, csrfToken);
    await request(app)
      .post('/api/issues')
      .set('X-CSRF-Token', csrfToken)
      .send({ project: 'SHC', title: 'Discuss me' });

    const comment = await request(app)
      .post('/api/issues/SHC-1/comments')
      .set('X-CSRF-Token', csrfToken)
      .send({ body: 'A **markdown** comment' });
    expect(comment.status).toBe(201);
    expect(comment.body.comment.body).toContain('markdown');

    const comments = await request(app).get('/api/issues/SHC-1/comments');
    expect(comments.body.items).toHaveLength(1);

    const link = await request(app)
      .post('/api/issues/SHC-1/links')
      .set('X-CSRF-Token', csrfToken)
      .send({ url: 'https://example.com/spec', label: 'Spec' });
    expect(link.status).toBe(201);
    expect(link.body.link.url).toBe('https://example.com/spec');

    const detail = await request(app).get('/api/issues/SHC-1');
    expect(detail.body.issue.comments).toHaveLength(1);
    expect(detail.body.issue.links).toHaveLength(1);
    expect(detail.body.issue.activity.length).toBeGreaterThan(1);

    const removed = await request(app)
      .delete(`/api/links/${link.body.link.id}`)
      .set('X-CSRF-Token', csrfToken);
    expect(removed.status).toBe(200);
    const after = await request(app).get('/api/issues/SHC-1');
    expect(after.body.issue.links).toHaveLength(0);
  });

  it('rejects missing CSRF tokens and foreign Host headers', async () => {
    const { app, csrfToken } = createHttpTestApp();
    await setupProject(app, csrfToken);

    const noCsrf = await request(app)
      .post('/api/issues')
      .send({ project: 'SHC', title: 'No token' });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('csrf_invalid');

    const foreignHost = await request(app)
      .get('/api/projects')
      .set('Host', 'evil.example');
    expect(foreignHost.status).toBe(403);
    expect(foreignHost.body.error.code).toBe('forbidden_host');
  });

  it('returns a JSON 404 for unknown API routes', async () => {
    const { app } = createHttpTestApp();
    const response = await request(app).get('/api/nope');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
  });
});
