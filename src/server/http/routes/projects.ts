import { Router } from 'express';
import type { Database } from '../../db/connection.js';
import type { ChangeBus } from '../../services/change-bus.js';
import {
  createModule,
  deleteModule,
  listModules,
  updateModule,
} from '../../domain/modules.js';
import {
  createProject,
  deleteProject,
  getProject,
  getProjectContext,
  listProjects,
  readProjectDocument,
  updateProject,
} from '../../domain/projects.js';
import { listTrashBatches, restoreTrashBatch } from '../../domain/trash.js';
import { getBoard } from '../../domain/issues.js';
import { listProjectActivity } from '../../domain/activity.js';
import { DomainError } from '../../domain/errors.js';
import { resolveRequestActor, optionalActorId } from '../actor-context.js';
import { mutateWithPublish } from '../publish.js';
import {
  moduleCreateSchema,
  moduleUpdateSchema,
  parseBody,
  projectCreateSchema,
  projectUpdateSchema,
  queryBoolean,
  queryCsv,
  queryNumber,
  queryString,
} from '../schemas.js';

export interface ProjectsRouterDeps {
  db: Database;
  bus: ChangeBus;
}

function boardQuery(
  projectRef: string,
  query: Record<string, unknown>,
): Parameters<typeof getBoard>[1] {
  return {
    project: projectRef,
    q: queryString(query.q),
    priorities: queryCsv(query.priorities ?? query.priority),
    assignee: queryString(query.assignee),
    module: queryString(query.module),
    parent: queryString(query.parent),
    blocked: queryBoolean(query.blocked),
    has_attachments: queryBoolean(query.has_attachments ?? query.attachments),
    updated_since: queryString(query.updated_since),
    include_deleted: queryBoolean(query.include_deleted),
    include_closed: queryBoolean(query.include_closed),
  };
}

export function createProjectsRouter({ db, bus }: ProjectsRouterDeps): Router {
  const router = Router();

  router.get('/projects', (_request, response) => {
    response.json({ ok: true, items: listProjects(db) });
  });

  router.post('/projects', (request, response) => {
    const body = parseBody(projectCreateSchema, request.body);
    const project = createProject(db, body);
    response.status(201).json({ ok: true, project });
  });

  router.get('/projects/:ref/board', (request, response) => {
    const input = boardQuery(request.params.ref, request.query);
    response.json({ ok: true, ...getBoard(db, input) });
  });

  router.get('/projects/:ref/context', (request, response) => {
    const actorId = optionalActorId(db, request);
    response.json({
      ok: true,
      ...getProjectContext(db, request.params.ref, actorId),
    });
  });

  router.get('/projects/:ref/docs', (request, response) => {
    const path = queryString(request.query.path);
    if (!path) throw new DomainError('validation_error', 'path is required');
    response.json({
      ok: true,
      ...readProjectDocument(db, request.params.ref, path),
    });
  });

  router.get('/projects/:ref/activity', (request, response) => {
    const project = getProject(db, request.params.ref);
    const limit = queryNumber(request.query.limit) ?? 50;
    const before = queryNumber(request.query.before);
    response.json({
      ok: true,
      items: listProjectActivity(db, project.id, limit, before),
    });
  });

  router.get('/projects/:ref/trash', (request, response) => {
    response.json({
      ok: true,
      items: listTrashBatches(db, request.params.ref),
    });
  });

  router.post('/projects/:ref/trash/:batch/restore', (request, response) => {
    const actor = resolveRequestActor(db, request);
    const result = mutateWithPublish(db, bus, () =>
      restoreTrashBatch(db, {
        project: request.params.ref,
        batch: request.params.batch,
        actor: actor.id,
      }),
    );
    response.json({ ok: true, ...result });
  });

  router.get('/projects/:ref/modules', (request, response) => {
    response.json({
      ok: true,
      items: listModules(db, request.params.ref),
    });
  });

  router.post('/projects/:ref/modules', (request, response) => {
    const body = parseBody(moduleCreateSchema, request.body);
    const result = createModule(db, {
      project: request.params.ref,
      name: body.name,
      color: body.color,
    });
    response.status(result.created ? 201 : 200).json({ ok: true, ...result });
  });

  router.patch('/modules/:id', (request, response) => {
    const body = parseBody(moduleUpdateSchema, request.body);
    response.json({ ok: true, module: updateModule(db, request.params.id, body) });
  });

  router.delete('/modules/:id', (request, response) => {
    deleteModule(db, request.params.id);
    response.json({ ok: true });
  });

  router.get('/projects/:ref', (request, response) => {
    response.json({ ok: true, project: getProject(db, request.params.ref) });
  });

  router.patch('/projects/:ref', (request, response) => {
    const body = parseBody(projectUpdateSchema, request.body);
    response.json({
      ok: true,
      project: updateProject(db, request.params.ref, body),
    });
  });

  router.delete('/projects/:ref', (request, response) => {
    deleteProject(db, request.params.ref);
    response.json({ ok: true });
  });

  return router;
}
