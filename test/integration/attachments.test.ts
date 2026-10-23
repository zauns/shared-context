import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createHttpTestApp, setupProject } from '../helpers/http.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function makePdf(text: string): Buffer {
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  );
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(output.length);
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}

function binaryParser(
  response: NodeJS.ReadableStream,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function seedIssue(app: ReturnType<typeof createHttpTestApp>['app'], csrfToken: string) {
  await setupProject(app, csrfToken);
  const created = await request(app)
    .post('/api/issues')
    .set('X-CSRF-Token', csrfToken)
    .send({ project: 'SHC', title: 'Attachment host' });
  expect(created.status).toBe(201);
  return created.body.issue as { key: string; id: string };
}

describe('Attachment HTTP API', () => {
  it('uploads an image, streams it, downloads it, and deduplicates by SHA-256', async () => {
    const { app, csrfToken, config } = createHttpTestApp();
    await seedIssue(app, csrfToken);

    const uploaded = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .set('X-CSRF-Token', csrfToken)
      .attach('file', PNG, { filename: 'screenshot.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.deduplicated).toBe(false);
    const attachment = uploaded.body.attachment;
    expect(attachment.original_name).toBe('screenshot.png');
    expect(attachment.mime_type).toBe('image/png');
    expect(attachment.is_image).toBe(true);
    expect(attachment.size_bytes).toBe(PNG.length);
    expect(uploaded.body.attachment.sha256).toMatch(/^[a-f0-9]{64}$/);

    const metadata = await request(app).get(`/api/attachments/${attachment.id}`);
    expect(metadata.status).toBe(200);
    expect(metadata.body.attachment.id).toBe(attachment.id);

    const content = await request(app)
      .get(`/api/attachments/${attachment.id}/content`)
      .buffer(true)
      .parse(binaryParser);
    expect(content.status).toBe(200);
    expect(content.headers['content-type']).toBe('image/png');
    expect(content.headers['content-disposition']).toMatch(/^inline;/);
    expect(content.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(content.body, PNG)).toBe(0);

    const download = await request(app)
      .get(`/api/attachments/${attachment.id}/content?download=1`)
      .buffer(true)
      .parse(binaryParser);
    expect(download.status).toBe(200);
    expect(download.headers['content-disposition']).toMatch(/^attachment;/);
    expect(download.headers['content-disposition']).toContain('filename="screenshot.png"');

    const duplicate = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .set('X-CSRF-Token', csrfToken)
      .attach('file', PNG, { filename: 'screenshot.png', contentType: 'image/png' });
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.deduplicated).toBe(true);
    expect(duplicate.body.attachment.id).toBe(attachment.id);

    const directories = fs.readdirSync(config.attachmentsDir);
    expect(directories).toEqual([attachment.id]);
    expect(fs.readdirSync(config.tmpDir)).toHaveLength(0);

    const detail = await request(app).get('/api/issues/SHC-1');
    expect(detail.body.issue.attachments).toHaveLength(1);
    expect(
      detail.body.issue.activity.some(
        (event: { type: string }) => event.type === 'attachment.added',
      ),
    ).toBe(true);
  });

  it('extracts text from Markdown and PDFs and marks PDFs without text', async () => {
    const { app, csrfToken } = createHttpTestApp();
    await seedIssue(app, csrfToken);

    const markdown = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .set('X-CSRF-Token', csrfToken)
      .attach('file', Buffer.from('# Notes\n\nHello world\n'), { filename: 'notes.md' });
    expect(markdown.status).toBe(201);
    expect(markdown.body.attachment.has_text).toBe(true);
    expect(markdown.body.attachment.mime_type).toBe('text/markdown');

    const pdf = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .set('X-CSRF-Token', csrfToken)
      .attach('file', makePdf('Hello attachment'), { filename: 'report.pdf' });
    expect(pdf.status).toBe(201);
    expect(pdf.body.attachment.mime_type).toBe('application/pdf');
    expect(pdf.body.attachment.has_text).toBe(true);

    const scanned = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .set('X-CSRF-Token', csrfToken)
      .attach('file', makePdf(''), { filename: 'scanned.pdf' });
    expect(scanned.status).toBe(201);
    expect(scanned.body.attachment.has_text).toBe(false);

    const markdownContent = await request(app)
      .get(`/api/attachments/${markdown.body.attachment.id}/content`)
      .buffer(true)
      .parse(binaryParser);
    expect(markdownContent.status).toBe(200);
    expect(markdownContent.headers['content-disposition']).toMatch(/^attachment;/);
    expect(markdownContent.body.toString('utf8')).toContain('Hello world');
  });

  it('rejects unsupported extensions, mismatched content, and binary text', async () => {
    const { app, csrfToken } = createHttpTestApp();
    await seedIssue(app, csrfToken);

    const executable = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .set('X-CSRF-Token', csrfToken)
      .attach('file', Buffer.from('MZ executable'), { filename: 'malware.exe' });
    expect(executable.status).toBe(415);
    expect(executable.body.error.code).toBe('unsupported_type');

    const svg = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .set('X-CSRF-Token', csrfToken)
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />'), {
        filename: 'vector.svg',
      });
    expect(svg.status).toBe(415);
    expect(svg.body.error.code).toBe('unsupported_type');

    const mismatched = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .set('X-CSRF-Token', csrfToken)
      .attach('file', Buffer.from('not really a png'), { filename: 'fake.png' });
    expect(mismatched.status).toBe(415);
    expect(mismatched.body.error.code).toBe('unsupported_type');

    const binaryText = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .set('X-CSRF-Token', csrfToken)
      .attach('file', Buffer.from([0x68, 0x69, 0x00, 0x01]), { filename: 'binary.txt' });
    expect(binaryText.status).toBe(415);
    expect(binaryText.body.error.code).toBe('unsupported_type');

    const missingFile = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .set('X-CSRF-Token', csrfToken)
      .field('name', 'empty.txt');
    expect(missingFile.status).toBe(400);
    expect(missingFile.body.error.code).toBe('validation_error');
  });

  it('rejects empty files and overlong names before copying anything', async () => {
    const { app, csrfToken, config } = createHttpTestApp();
    await seedIssue(app, csrfToken);

    const empty = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .set('X-CSRF-Token', csrfToken)
      .attach('file', Buffer.alloc(0), { filename: 'empty.txt' });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('validation_error');

    const overlong = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .set('X-CSRF-Token', csrfToken)
      .field('name', `${'a'.repeat(256)}.png`)
      .attach('file', PNG, { filename: 'screenshot.png', contentType: 'image/png' });
    expect(overlong.status).toBe(400);
    expect(overlong.body.error.code).toBe('validation_error');

    expect(fs.readdirSync(config.attachmentsDir)).toHaveLength(0);
    expect(fs.readdirSync(config.tmpDir)).toHaveLength(0);
  });

  it('rejects uploads above 25 MB and leaves no temp file behind', async () => {
    const { app, csrfToken, config } = createHttpTestApp();
    await seedIssue(app, csrfToken);

    const tooLarge = Buffer.alloc(25 * 1024 * 1024 + 1, 0x61);
    const response = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .set('X-CSRF-Token', csrfToken)
      .attach('file', tooLarge, { filename: 'huge.txt' });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('attachment_too_large');
    expect(fs.readdirSync(config.tmpDir)).toHaveLength(0);
    expect(fs.readdirSync(config.attachmentsDir)).toHaveLength(0);
  });

  it('requires CSRF for upload and open', async () => {
    const { app, csrfToken } = createHttpTestApp();
    await seedIssue(app, csrfToken);

    const uploaded = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .attach('file', PNG, { filename: 'screenshot.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(403);
    expect(uploaded.body.error.code).toBe('csrf_invalid');

    const opened = await request(app).post('/api/attachments/anything/open');
    expect(opened.status).toBe(403);
  });

  it('opens a file with spaces and non-ASCII characters through the injected handler', async () => {
    const opened: string[] = [];
    const { app, csrfToken } = createHttpTestApp({
      openFile: async (filePath) => {
        opened.push(filePath);
      },
    });
    await seedIssue(app, csrfToken);

    const uploaded = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .set('X-CSRF-Token', csrfToken)
      .attach('file', PNG, { filename: 'a file açúcar.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.attachment.original_name).toBe('a file açúcar.png');

    const response = await request(app)
      .post(`/api/attachments/${uploaded.body.attachment.id}/open`)
      .set('X-CSRF-Token', csrfToken)
      .send({});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(opened).toHaveLength(1);
    expect(path.basename(opened[0]!)).toBe('a file açúcar.png');
    expect(fs.existsSync(opened[0]!)).toBe(true);

    await request(app)
      .delete(`/api/attachments/${uploaded.body.attachment.id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({});

    const afterDelete = await request(app)
      .post(`/api/attachments/${uploaded.body.attachment.id}/open`)
      .set('X-CSRF-Token', csrfToken)
      .send({});
    expect(afterDelete.status).toBe(404);
  });

  it('serves content only from inside the data directory', async () => {
    const { app, db, csrfToken, config } = createHttpTestApp();
    await seedIssue(app, csrfToken);

    const uploaded = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .set('X-CSRF-Token', csrfToken)
      .attach('file', PNG, { filename: 'screenshot.png', contentType: 'image/png' });
    const id = uploaded.body.attachment.id as string;

    const outsidePath = path.resolve(config.dataDir, '..', '..', 'outside-attachment.txt');
    fs.writeFileSync(outsidePath, 'outside the store');
    db.prepare('UPDATE attachments SET stored_path = ? WHERE id = ?').run(
      '../../outside-attachment.txt',
      id,
    );

    const escaped = await request(app).get(`/api/attachments/${id}/content`);
    expect(escaped.status).toBe(404);
    expect(escaped.body.error.code).toBe('not_found');

    db.prepare('UPDATE attachments SET stored_path = ? WHERE id = ?').run(
      outsidePath,
      id,
    );
    const absolute = await request(app).get(`/api/attachments/${id}/content`);
    expect(absolute.status).toBe(404);

    fs.rmSync(outsidePath, { force: true });
  });

  it('soft-deletes an Attachment, hides it, and keeps the stored file', async () => {
    const { app, csrfToken, config } = createHttpTestApp();
    await seedIssue(app, csrfToken);

    const uploaded = await request(app)
      .post('/api/issues/SHC-1/attachments')
      .set('X-CSRF-Token', csrfToken)
      .attach('file', PNG, { filename: 'screenshot.png', contentType: 'image/png' });
    const id = uploaded.body.attachment.id as string;

    const removed = await request(app)
      .delete(`/api/attachments/${id}`)
      .set('X-CSRF-Token', csrfToken)
      .send({});
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ ok: true });

    expect((await request(app).get(`/api/attachments/${id}`)).status).toBe(404);
    expect((await request(app).get(`/api/attachments/${id}/content`)).status).toBe(404);

    const detail = await request(app).get('/api/issues/SHC-1');
    expect(detail.body.issue.attachments).toHaveLength(0);

    const stored = fs.readdirSync(config.attachmentsDir, { recursive: true });
    expect(stored.some((entry) => String(entry).endsWith('screenshot.png'))).toBe(true);
  });
});