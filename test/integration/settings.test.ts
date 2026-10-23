import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createHttpTestApp, setupProject } from '../helpers/http.js';
import {
  buildMarkdownExport,
  zipEntries,
} from '../../src/server/services/export.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function binaryParser(
  response: NodeJS.ReadableStream,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function createIssue(
  app: ReturnType<typeof createHttpTestApp>['app'],
  csrfToken: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await request(app)
    .post('/api/issues')
    .set('X-CSRF-Token', csrfToken)
    .send(body);
  expect(response.status).toBe(201);
  return response.body.issue;
}

describe('M7 project settings', () => {
  it('round-trips project fields and reports module usage', async () => {
    const { app, csrfToken } = createHttpTestApp();
    await setupProject(app, csrfToken);

    const moduleResponse = await request(app)
      .post('/api/projects/SHC/modules')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'API', color: '#f97316' });
    expect(moduleResponse.status).toBe(201);
    expect(moduleResponse.body.module.usage_count).toBe(0);

    await createIssue(app, csrfToken, {
      project: 'SHC',
      title: 'Module-using Issue',
      module: 'api',
    });

    const project = await request(app).get('/api/projects/SHC');
    expect(project.status).toBe(200);
    expect(project.body.project.doc_allowlist).toContain('AGENTS.md');
    expect(project.body.project.modules[0].usage_count).toBe(1);

    const updated = await request(app)
      .patch('/api/projects/SHC')
      .set('X-CSRF-Token', csrfToken)
      .send({
        name: 'Shared Context Renamed',
        description: 'Updated from settings',
        doc_allowlist: ['README.md', 'docs/**/*.md'],
      });
    expect(updated.status).toBe(200);
    expect(updated.body.project.name).toBe('Shared Context Renamed');
    expect(updated.body.project.doc_allowlist).toEqual([
      'README.md',
      'docs/**/*.md',
    ]);

    const reloaded = await request(app).get('/api/projects/SHC');
    expect(reloaded.body.project.description).toBe('Updated from settings');
    expect(reloaded.body.project.doc_allowlist).toEqual([
      'README.md',
      'docs/**/*.md',
    ]);

    const invalidAllowlist = await request(app)
      .patch('/api/projects/SHC')
      .set('X-CSRF-Token', csrfToken)
      .send({ doc_allowlist: ['../secret.md'] });
    expect(invalidAllowlist.status).toBe(400);
    expect(invalidAllowlist.body.error.code).toBe('validation_error');

    const renamedModule = await request(app)
      .patch(`/api/modules/${moduleResponse.body.module.id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'API v2', color: '#22c55e' });
    expect(renamedModule.status).toBe(200);
    expect(renamedModule.body.module.name).toBe('API v2');
    expect(renamedModule.body.module.usage_count).toBe(1);

    const inUse = await request(app)
      .delete(`/api/modules/${moduleResponse.body.module.id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({});
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.code).toBe('module_in_use');
  });

  it('refuses non-allowlisted and escaping doc paths', async () => {
    const { app, csrfToken } = createHttpTestApp();
    await setupProject(app, csrfToken);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-context-docs-'));
    fs.writeFileSync(path.join(root, 'README.md'), '# Project readme\n');
    fs.writeFileSync(path.join(root, 'secret.md'), 'not allowlisted\n');

    try {
      const patched = await request(app)
        .patch('/api/projects/SHC')
        .set('X-CSRF-Token', csrfToken)
        .send({ root_path: root, doc_allowlist: ['README.md'] });
      expect(patched.status).toBe(200);

      const allowed = await request(app).get('/api/projects/SHC/docs?path=README.md');
      expect(allowed.status).toBe(200);
      expect(allowed.body.content).toContain('Project readme');

      const denied = await request(app).get('/api/projects/SHC/docs?path=secret.md');
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('doc_not_allowed');

      const traversal = await request(app).get(
        '/api/projects/SHC/docs?path=../secret.md',
      );
      expect(traversal.status).toBe(400);
      expect(traversal.body.error.code).toBe('validation_error');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('lists and restores a deleted subtree as one batch', async () => {
    const { app, csrfToken } = createHttpTestApp();
    await setupProject(app, csrfToken);

    await createIssue(app, csrfToken, { project: 'SHC', title: 'Parent' });
    await createIssue(app, csrfToken, {
      project: 'SHC',
      title: 'Child',
      parent: 'SHC-1',
    });
    const detail = await request(app).get('/api/issues/SHC-1');
    const deleted = await request(app)
      .delete('/api/issues/SHC-1?cascade=true&expected_rev=1')
      .set('X-CSRF-Token', csrfToken)
      .send({});
    expect(deleted.status).toBe(200);
    expect(detail.body.issue.children).toHaveLength(1);

    const trash = await request(app).get('/api/projects/SHC/trash');
    expect(trash.status).toBe(200);
    expect(trash.body.items).toHaveLength(1);
    expect(trash.body.items[0].issues.map((issue: { key: string }) => issue.key)).toEqual([
      'SHC-1',
      'SHC-2',
    ]);
    expect(trash.body.items[0].deleted_by.name).toBe('Owner');

    const restored = await request(app)
      .post(`/api/projects/SHC/trash/${trash.body.items[0].batch}/restore`)
      .set('X-CSRF-Token', csrfToken)
      .send({});
    expect(restored.status).toBe(200);
    expect(restored.body.restored).toHaveLength(2);

    const board = await request(app).get('/api/projects/SHC/board');
    expect(board.body.filtered_count).toBe(2);
    expect((await request(app).get('/api/projects/SHC/trash')).body.items).toHaveLength(0);

    const after = await request(app).get('/api/issues/SHC-1');
    expect(
      after.body.issue.activity.some(
        (event: { type: string }) => event.type === 'issue.restored',
      ),
    ).toBe(true);
  });
});

describe('M7 backups', () => {
  it('creates a verified snapshot, mirrors attachments, and updates status', async () => {
    const { app, csrfToken, config, db } = createHttpTestApp();
    await setupProject(app, csrfToken);
    await createIssue(app, csrfToken, { project: 'SHC', title: 'Backed up Issue' });

    const uploaded = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .set('X-CSRF-Token', csrfToken)
      .attach('file', PNG, { filename: 'backup.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(201);

    const backup = await request(app)
      .post('/api/admin/backup')
      .set('X-CSRF-Token', csrfToken)
      .send({});
    expect(backup.status).toBe(200);
    expect(backup.body.backup.ok).toBe(true);

    const snapshotPath = path.join(
      config.backupDir,
      'db',
      backup.body.backup.filename,
    );
    expect(fs.existsSync(snapshotPath)).toBe(true);

    const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
    try {
      const row = snapshot
        .prepare('SELECT key FROM issues WHERE key = ?')
        .get('SHC-1') as unknown as { key: string } | undefined;
      expect(row?.key).toBe('SHC-1');
      expect(
        (snapshot.prepare('PRAGMA integrity_check').get() as { integrity_check: string })
          .integrity_check,
      ).toBe('ok');
    } finally {
      snapshot.close();
    }

    const mirrored = path.join(
      config.backupDir,
      'attachments',
      uploaded.body.attachment.id,
      'backup.png',
    );
    expect(fs.existsSync(mirrored)).toBe(true);

    const listed = await request(app).get('/api/admin/backups');
    expect(listed.status).toBe(200);
    expect(listed.body.items[0].filename).toBe(backup.body.backup.filename);
    expect(listed.body.last.ok).toBe(true);

    const health = await request(app).get('/healthz');
    expect(health.body.last_backup.filename).toBe(backup.body.backup.filename);
    expect(health.body.schema_version).toBeGreaterThan(0);

    const configResponse = await request(app).get('/api/config');
    expect(configResponse.body.last_backup.ok).toBe(true);
    expect(configResponse.body.token).toBeUndefined();
    expect(JSON.stringify(configResponse.body)).not.toContain(config.token);

    // The snapshot opens independently of the live database.
    expect(db.prepare('SELECT COUNT(*) AS count FROM projects').get()).toBeTruthy();
  });

  it('prunes older snapshots by retention count', async () => {
    const { app, csrfToken, config } = createHttpTestApp();
    await setupProject(app, csrfToken);
    config.backupRetentionDays = 2;

    for (let index = 0; index < 3; index += 1) {
      const response = await request(app)
        .post('/api/admin/backup')
        .set('X-CSRF-Token', csrfToken)
        .send({});
      expect(response.status).toBe(200);
    }

    const listed = await request(app).get('/api/admin/backups');
    expect(listed.body.items).toHaveLength(2);
  });
});

describe('M7 export', () => {
  it('builds one Markdown file per Issue plus the board index', async () => {
    const { app, csrfToken, db } = createHttpTestApp();
    await setupProject(app, csrfToken);
    await createIssue(app, csrfToken, {
      project: 'SHC',
      title: 'Export parent',
      priority: 'high',
      links: [{ url: 'https://example.com/spec', label: 'Spec' }],
    });
    await createIssue(app, csrfToken, {
      project: 'SHC',
      title: 'Export child',
      parent: 'SHC-1',
    });
    await request(app)
      .post('/api/issues/SHC-1/comments')
      .set('X-CSRF-Token', csrfToken)
      .send({ body: 'Export comment' });

    const exported = buildMarkdownExport(db, 'SHC');
    const names = exported.entries.map((entry) => entry.name);
    expect(names).toContain('_board.md');
    expect(names).toContain('attachments/index.md');
    expect(names.filter((name) => name.endsWith('.md'))).toHaveLength(4);

    const board = exported.entries.find((entry) => entry.name === '_board.md')!;
    expect(board.content).toContain('## Backlog (2)');
    expect(board.content).toContain('Priority: high');

    const parent = exported.entries.find((entry) =>
      entry.name.startsWith('SHC-1-'),
    )!;
    expect(parent.content).toContain('stage: backlog');
    expect(parent.content).toContain('Export comment');
    expect(parent.content).toContain('## Children');
    expect(parent.content).toContain('SHC-2-');

    const zipped = await zipEntries(exported.entries);
    expect(zipped.subarray(0, 2).toString('utf8')).toBe('PK');
    expect(zipped.length).toBeGreaterThan(100);

    const response = await request(app)
      .get('/api/admin/export?project=SHC&format=md')
      .buffer(true)
      .parse(binaryParser);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/zip');
    expect(response.headers['content-disposition']).toContain('export-SHC-');
    expect(response.body.subarray(0, 2).toString('utf8')).toBe('PK');
  });

  it('exports JSON without attachment bytes or the token', async () => {
    const { app, csrfToken, config } = createHttpTestApp();
    await setupProject(app, csrfToken);
    await createIssue(app, csrfToken, { project: 'SHC', title: 'JSON Issue' });

    const response = await request(app).get('/api/admin/export?project=SHC&format=json');
    expect(response.status).toBe(200);
    expect(response.body.projects[0].key).toBe('SHC');
    expect(response.body.issues).toHaveLength(1);
    expect(response.body.issues[0].key).toBe('SHC-1');
    expect(JSON.stringify(response.body)).not.toContain(config.token);

    const missingProject = await request(app).get('/api/admin/export?format=md');
    expect(missingProject.status).toBe(400);
  });
});

describe('M7 MCP token', () => {
  it('reveals and regenerates the token, persisting it to config', async () => {
    const { app, csrfToken, config } = createHttpTestApp();
    const originalToken = config.token;

    const revealed = await request(app)
      .post('/api/admin/token/reveal')
      .set('X-CSRF-Token', csrfToken)
      .send({});
    expect(revealed.status).toBe(200);
    expect(revealed.body.token).toBe(originalToken);

    const regenerated = await request(app)
      .post('/api/admin/token/regenerate')
      .set('X-CSRF-Token', csrfToken)
      .send({});
    expect(regenerated.status).toBe(200);
    expect(regenerated.body.token).not.toBe(originalToken);
    expect(config.token).toBe(regenerated.body.token);

    const stored = JSON.parse(fs.readFileSync(config.configPath, 'utf8')) as {
      token: string;
    };
    expect(stored.token).toBe(regenerated.body.token);

    const missingCsrf = await request(app).post('/api/admin/token/regenerate');
    expect(missingCsrf.status).toBe(403);
  });
});