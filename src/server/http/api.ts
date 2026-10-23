import { Router } from 'express';
import type { Database } from '../db/connection.js';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { ChangeBus } from '../services/change-bus.js';
import type { OpenFile } from '../services/open-file.js';
import { csrfGuard } from './middleware.js';
import { createAttachmentsRouter } from './routes/attachments.js';
import { createEventsRouter } from './routes/events.js';
import { createIssuesRouter } from './routes/issues.js';
import { createProjectsRouter } from './routes/projects.js';
import { createSystemRouter } from './routes/system.js';

export interface ApiRouterDeps {
  db: Database;
  config: AppConfig;
  logger: Logger;
  bus: ChangeBus;
  csrfToken: string;
  openFile?: OpenFile;
}

export function createApiRouter(deps: ApiRouterDeps): Router {
  const router = Router();
  router.use(csrfGuard(deps.csrfToken));
  router.use(createSystemRouter(deps));
  router.use(createProjectsRouter({ db: deps.db }));
  router.use(createIssuesRouter({ db: deps.db, bus: deps.bus }));
  router.use(
    createAttachmentsRouter({
      db: deps.db,
      config: deps.config,
      bus: deps.bus,
      openFile: deps.openFile,
    }),
  );
  router.use(createEventsRouter({ db: deps.db, bus: deps.bus }));
  return router;
}
