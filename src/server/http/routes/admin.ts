import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { AppConfig } from '../../config.js';
import { persistConfigToken } from '../../config.js';
import type { Database } from '../../db/connection.js';
import { DomainError } from '../../domain/errors.js';
import type { Logger } from '../../logger.js';
import {
  createBackup,
  listBackups,
  readLastBackup,
} from '../../services/backups.js';
import {
  buildJsonExport,
  buildMarkdownExport,
  exportStamp,
  zipEntries,
} from '../../services/export.js';
import { asyncHandler } from '../errors.js';
import { queryString } from '../schemas.js';

export interface AdminRouterDeps {
  db: Database;
  config: AppConfig;
  logger: Logger;
}

export function createAdminRouter({ db, config, logger }: AdminRouterDeps): Router {
  const router = Router();

  router.post('/admin/backup', (_request, response) => {
    const backup = createBackup(db, config);
    logger.info({ filename: backup.filename, size_bytes: backup.size_bytes }, 'manual backup');
    response.json({ ok: true, backup });
  });

  router.get('/admin/backups', (_request, response) => {
    response.json({
      ok: true,
      items: listBackups(config),
      last: readLastBackup(config),
    });
  });

  router.get(
    '/admin/export',
    asyncHandler(async (request, response) => {
      const project = queryString(request.query.project);
      const format = queryString(request.query.format) ?? 'md';
      if (format === 'md') {
        if (!project) {
          throw new DomainError(
            'validation_error',
            'project is required for Markdown export',
          );
        }
        const { filename, entries } = buildMarkdownExport(db, project);
        const buffer = await zipEntries(entries);
        response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        response.type('application/zip').send(buffer);
        return;
      }
      if (format === 'json') {
        const payload = buildJsonExport(db, project);
        const filename = `export-${project ?? 'all'}-${exportStamp()}.json`;
        response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        response.type('application/json').send(`${JSON.stringify(payload, null, 2)}\n`);
        return;
      }
      throw new DomainError('validation_error', `Unknown export format: ${format}`);
    }),
  );

  router.post('/admin/token/reveal', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.json({ ok: true, token: config.token });
  });

  router.post('/admin/token/regenerate', (_request, response) => {
    const token = randomBytes(32).toString('base64url');
    persistConfigToken(config.configPath, token);
    config.token = token;
    logger.info('MCP token regenerated');
    response.setHeader('Cache-Control', 'no-store');
    response.json({ ok: true, token });
  });

  return router;
}