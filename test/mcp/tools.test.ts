import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { currentActivityCursor } from '../../src/server/db/repositories/activities.js';
import { createHttpTestApp, setupProject } from '../helpers/http.js';

interface Harness {
  app: ReturnType<typeof createHttpTestApp>['app'];
  db: ReturnType<typeof createHttpTestApp>['db'];
  config: ReturnType<typeof createHttpTestApp>['config'];
  csrfToken: string;
  server: ReturnType<ReturnType<typeof createHttpTestApp>['app']['listen']>;
  port: number;
  client: Client;
}

const openHarnesses: Harness[] = [];

async function createHarness(): Promise<Harness> {
  const { app, db, config, csrfToken } = createHttpTestApp();
  await setupProject(app, csrfToken);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const client = new Client({ name: 'shared-context-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${config.token}` },
      },
    },
  );
  await client.connect(transport);
  const harness = { app, db, config, csrfToken, server, port, client };
  openHarnesses.push(harness);
  return harness;
}

async function closeHarness(harness: Harness): Promise<void> {
  await harness.client.close().catch(() => {});
  await new Promise<void>((resolve) => harness.server.close(() => resolve()));
  harness.db.close();
  const index = openHarnesses.indexOf(harness);
  if (index >= 0) openHarnesses.splice(index, 1);
}

async function call(
  harness: Harness,
  name: string,
  args: Record<string, unknown> = {},
  // Test helper: tool payloads are deliberately dynamic JSON.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ isError: boolean; body: any; content: any[] }> {
  const result = await harness.client.callTool({ name, arguments: args });
  const text = result.content.find(
    (entry): entry is { type: 'text'; text: string } => entry.type === 'text',
  );
  return {
    isError: result.isError === true,
    body: text ? JSON.parse(text.text) : null,
    content: result.content,
  };
}

afterEach(async () => {
  while (openHarnesses.length > 0) {
    const harness = openHarnesses.pop();
    if (harness) await closeHarness(harness);
  }
});

describe('MCP tools', () => {
  it('identifies, creates Issues, reads the board, and detects stale updates', async () => {
    const harness = await createHarness();
    const tools = await harness.client.listTools();
    expect(tools.tools).toHaveLength(23);
    expect(tools.tools.map((tool) => tool.name)).toContain('identify');

    const identified = await call(harness, 'identify', {
      actor: 'frontend-agent',
      default_project: 'SHC',
      can_read_images: true,
    });
    expect(identified.isError).toBe(false);
    expect(identified.body.actor.name).toBe('frontend-agent');

    const projects = await call(harness, 'list_projects');
    expect(projects.body.items).toHaveLength(1);

    const created = await call(harness, 'create_issue', {
      title: 'MCP issue',
      priority: 'high',
    });
    expect(created.isError).toBe(false);
    expect(created.body.issue.key).toBe('SHC-1');

    const board = await call(harness, 'get_board');
    expect(board.body.columns.find((column: { stage: string }) => column.stage === 'backlog').count).toBe(1);

    const stale = await call(harness, 'update_issue', {
      issue: 'SHC-1',
      expected_rev: 99,
      title: 'Stale',
    });
    expect(stale.isError).toBe(true);
    expect(stale.body.error.code).toBe('conflict');
    expect(stale.body.issue.rev).toBe(1);

    const updated = await call(harness, 'update_issue', {
      issue: 'SHC-1',
      expected_rev: 1,
      title: 'Updated',
    });
    expect(updated.body.issue.rev).toBe(2);

    const claimed = await call(harness, 'claim_issue', { issue: 'SHC-1' });
    expect(claimed.body.claimed).toBe(true);
    expect(claimed.body.issue.assignee.name).toBe('frontend-agent');
  });

  it('wakes wait_for_change after an HTTP mutation', async () => {
    const harness = await createHarness();
    await call(harness, 'identify', {
      actor: 'frontend-agent',
      default_project: 'SHC',
    });
    const cursor = currentActivityCursor(harness.db);
    const waiting = call(harness, 'wait_for_change', {
      since_activity_id: cursor,
      timeout_seconds: 2,
    });

    await request(harness.app)
      .post('/api/issues')
      .set('X-CSRF-Token', harness.csrfToken)
      .send({ project: 'SHC', title: 'Wake up' });

    const result = await waiting;
    expect(result.isError).toBe(false);
    expect(result.body.timed_out).toBe(false);
    expect(result.body.events[0].type).toBe('issue.created');
  });

  it('reads allowlisted project docs and refuses traversal', async () => {
    const harness = await createHarness();
    await call(harness, 'identify', { actor: 'frontend-agent', default_project: 'SHC' });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-context-docs-'));
    fs.writeFileSync(path.join(root, 'CONTEXT.md'), '# Context\nAllowed.\n');
    await request(harness.app)
      .patch('/api/projects/SHC')
      .set('X-CSRF-Token', harness.csrfToken)
      .send({ root_path: root });

    const allowed = await call(harness, 'read_project_doc', { path: 'CONTEXT.md' });
    expect(allowed.isError).toBe(false);
    expect(allowed.body.content).toContain('Allowed');

    const refused = await call(harness, 'read_project_doc', { path: '../secret.md' });
    expect(refused.isError).toBe(true);
    expect(refused.body.error.code).toBe('validation_error');
  });

  it('copies attachments, reads text, and gates images by capability', async () => {
    const harness = await createHarness();
    await call(harness, 'identify', {
      actor: 'frontend-agent',
      default_project: 'SHC',
      can_read_images: true,
    });
    await call(harness, 'create_issue', { title: 'Has attachments' });

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-context-files-'));
    const textFile = path.join(directory, 'note.md');
    fs.writeFileSync(textFile, '# Note\nSome text.\n', 'utf8');
    const textAdded = await call(harness, 'add_attachment', {
      issue: 'SHC-1',
      path: textFile,
    });
    expect(textAdded.isError).toBe(false);
    expect(textAdded.body.attachment.original_name).toBe('note.md');

    const textRead = await call(harness, 'read_attachment', {
      attachment_id: textAdded.body.attachment.id,
      mode: 'text',
    });
    expect(textRead.body.text).toContain('Some text');

    const pngFile = path.join(directory, 'pixel.png');
    fs.writeFileSync(
      pngFile,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const imageAdded = await call(harness, 'add_attachment', {
      issue: 'SHC-1',
      path: pngFile,
    });
    expect(imageAdded.isError).toBe(false);

    const visionRead = await call(harness, 'read_attachment', {
      attachment_id: imageAdded.body.attachment.id,
    });
    expect(visionRead.content.some((entry: { type: string }) => entry.type === 'image')).toBe(true);

    await call(harness, 'identify', {
      actor: 'frontend-agent',
      default_project: 'SHC',
      can_read_images: false,
    });
    const metadataRead = await call(harness, 'read_attachment', {
      attachment_id: imageAdded.body.attachment.id,
    });
    expect(metadataRead.content.some((entry: { type: string }) => entry.type === 'image')).toBe(false);
    expect(metadataRead.body.attachment.id).toBe(imageAdded.body.attachment.id);
  });

  it('adds comments and links', async () => {
    const harness = await createHarness();
    await call(harness, 'identify', { actor: 'frontend-agent', default_project: 'SHC' });
    await call(harness, 'create_issue', { title: 'Collaboration' });

    const comment = await call(harness, 'add_comment', {
      issue: 'SHC-1',
      body: 'A **markdown** handoff.',
    });
    expect(comment.body.comment.body).toContain('markdown');

    const link = await call(harness, 'add_link', {
      issue: 'SHC-1',
      url: 'https://example.com/spec',
      label: 'Spec',
    });
    expect(link.body.link.url).toBe('https://example.com/spec');

    const removed = await call(harness, 'remove_link', {
      issue: 'SHC-1',
      link_id: link.body.link.id,
    });
    expect(removed.isError).toBe(false);

    const issue = await call(harness, 'get_issue', { issue: 'SHC-1' });
    expect(issue.body.issue.links).toHaveLength(0);
    expect(issue.body.issue.comments).toHaveLength(1);
  });

  it('extracts text from a text PDF', async () => {
    const harness = await createHarness();
    await call(harness, 'identify', { actor: 'frontend-agent', default_project: 'SHC' });
    await call(harness, 'create_issue', { title: 'Has a PDF' });

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-context-pdf-'));
    const pdfFile = path.join(directory, 'note.pdf');
    fs.writeFileSync(pdfFile, makePdf('Hello PDF'));
    const added = await call(harness, 'add_attachment', {
      issue: 'SHC-1',
      path: pdfFile,
    });
    expect(added.isError).toBe(false);

    const read = await call(harness, 'read_attachment', {
      attachment_id: added.body.attachment.id,
      mode: 'text',
    });
    expect(read.isError).toBe(false);
    expect(read.body.text).toContain('Hello PDF');
  });

  it('rejects requests without the bearer token', async () => {
    const harness = await createHarness();
    const response = await fetch(`http://127.0.0.1:${harness.port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'unauthorized', version: '1.0.0' },
        },
      }),
    });
    expect(response.status).toBe(401);
  });
});

function makePdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 120 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}
