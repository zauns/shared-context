import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/connection.js';
import { findAttachmentRow } from '../../db/repositories/attachments.js';
import { getAttachment, removeAttachment } from '../../domain/attachments.js';
import { DomainError } from '../../domain/errors.js';
import {
  MAX_ATTACHMENT_BYTES,
  addAttachmentFromPath,
  resolveAttachmentFile,
} from '../../services/attachments.js';
import type { ChangeBus } from '../../services/change-bus.js';
import { mutateAsyncWithPublish, mutateWithPublish } from '../../services/mutations.js';
import {
  openWithDefaultApplication,
  type OpenFile,
} from '../../services/open-file.js';
import { resolveRequestActor } from '../actor-context.js';
import { queryBoolean } from '../schemas.js';

export interface AttachmentsRouterDeps {
  db: Database;
  config: AppConfig;
  bus: ChangeBus;
  openFile?: OpenFile;
}

function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function uploadMiddleware(config: AppConfig): RequestHandler {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_request, _file, done) => done(null, config.tmpDir),
      filename: (_request, _file, done) => done(null, `upload-${randomUUID()}.tmp`),
    }),
    limits: {
      fileSize: MAX_ATTACHMENT_BYTES,
      files: 1,
      fields: 10,
      fieldSize: 1024 * 1024,
    },
    defParamCharset: 'utf8',
  });

  return (request, response, next) => {
    upload.single('file')(request, response, (error: unknown) => {
      if (!error) {
        next();
        return;
      }
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          next(
            new DomainError(
              'attachment_too_large',
              'Attachment exceeds the 25 MB limit',
            ),
          );
          return;
        }
        next(new DomainError('validation_error', `Upload rejected: ${error.code}`));
        return;
      }
      next(error);
    });
  };
}

export function createAttachmentsRouter({
  db,
  config,
  bus,
  openFile = openWithDefaultApplication,
}: AttachmentsRouterDeps): Router {
  const router = Router();
  const upload = uploadMiddleware(config);

  router.post('/issues/:key/attachments', upload, async (request, response) => {
    const file = request.file;
    if (!file) {
      throw new DomainError('validation_error', 'A file field is required');
    }
    try {
      const actor = resolveRequestActor(db, request);
      const issueKey = String(request.params.key);
      const suppliedName =
        typeof request.body?.name === 'string' ? request.body.name.trim() : '';
      const result = await mutateAsyncWithPublish(db, bus, () =>
        addAttachmentFromPath(db, config, {
          issue: issueKey,
          filePath: file.path,
          name: suppliedName || file.originalname,
          actor: actor.id,
        }),
      );
      response.status(201).json({
        ok: true,
        attachment: result.attachment,
        deduplicated: result.deduplicated,
      });
    } finally {
      fs.rmSync(file.path, { force: true });
    }
  });

  router.get('/attachments/:id/content', (request, response, next) => {
    const { row, absolutePath } = resolveAttachmentFile(db, config, request.params.id);
    const download = queryBoolean(request.query.download) === true;
    const inline =
      !download && (row.mime_type.startsWith('image/') || row.mime_type === 'application/pdf');

    response.setHeader('Content-Type', row.mime_type);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      contentDisposition(inline ? 'inline' : 'attachment', row.original_name),
    );
    response.setHeader('Cache-Control', 'private, max-age=3600');

    response.sendFile(absolutePath, { acceptRanges: true }, (error) => {
      if (!error) return;
      if (!response.headersSent) {
        next(new DomainError('not_found', `Attachment content is unavailable`));
        return;
      }
      response.end();
    });
  });

  router.post('/attachments/:id/open', async (request, response) => {
    const { absolutePath } = resolveAttachmentFile(db, config, request.params.id);
    await openFile(absolutePath);
    response.json({ ok: true });
  });

  router.delete('/attachments/:id', (request, response) => {
    const attachment = findAttachmentRow(db, request.params.id);
    if (!attachment || attachment.deleted_at) {
      throw new DomainError('not_found', `Attachment not found: ${request.params.id}`);
    }
    const actor = resolveRequestActor(db, request);
    mutateWithPublish(db, bus, () =>
      removeAttachment(db, {
        issue: attachment.issue_id,
        attachment_id: attachment.id,
        actor: actor.id,
      }),
    );
    response.json({ ok: true });
  });

  router.get('/attachments/:id', (request, response) => {
    response.json({ ok: true, attachment: getAttachment(db, request.params.id) });
  });

  return router;
}
