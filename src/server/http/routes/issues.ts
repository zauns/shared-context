import { Router } from 'express';
import type { Database } from '../../db/connection.js';
import { findLinkRow } from '../../db/repositories/links.js';
import { listIssueActivity } from '../../domain/activity.js';
import {
  addComment,
  deleteComment,
  listComments,
  updateComment,
} from '../../domain/comments.js';
import { DomainError } from '../../domain/errors.js';
import {
  blockIssue,
  claimIssue,
  createIssue,
  deleteIssue,
  getIssue,
  listIssues,
  moveIssue,
  releaseIssue,
  restoreIssue,
  unblockIssue,
  updateIssue,
  type ListIssuesInput,
} from '../../domain/issues.js';
import { addLink, removeLink } from '../../domain/links.js';
import type { ChangeBus } from '../../services/change-bus.js';
import { resolveRequestActor } from '../actor-context.js';
import { mutateWithPublish } from '../publish.js';
import {
  blockSchema,
  claimSchema,
  commentCreateSchema,
  commentUpdateSchema,
  deleteSchema,
  issueCreateSchema,
  issueMoveSchema,
  issueUpdateSchema,
  linkCreateSchema,
  parseBody,
  queryBoolean,
  queryCsv,
  queryNumber,
  queryString,
  releaseSchema,
  unblockSchema,
} from '../schemas.js';

export interface IssuesRouterDeps {
  db: Database;
  bus: ChangeBus;
}

function listQuery(query: Record<string, unknown>): ListIssuesInput {
  const project = queryString(query.project);
  if (!project) throw new DomainError('validation_error', 'project is required');
  const sort = queryString(query.sort);
  const view = queryString(query.view);
  return {
    project,
    q: queryString(query.q),
    stages: queryCsv(query.stages ?? query.stage),
    priorities: queryCsv(query.priorities ?? query.priority),
    assignee: queryString(query.assignee),
    module: queryString(query.module),
    parent: queryString(query.parent),
    blocked: queryBoolean(query.blocked),
    has_attachments: queryBoolean(query.has_attachments ?? query.attachments),
    updated_since: queryString(query.updated_since),
    include_deleted: queryBoolean(query.include_deleted),
    limit: queryNumber(query.limit),
    cursor: queryString(query.cursor),
    view: view === 'full' ? 'full' : 'compact',
    sort: sort === 'priority' || sort === 'position' ? sort : 'updated',
  };
}

export function createIssuesRouter({ db, bus }: IssuesRouterDeps): Router {
  const router = Router();

  router.get('/issues', (request, response) => {
    response.json({ ok: true, ...listIssues(db, listQuery(request.query)) });
  });

  router.post('/issues', (request, response) => {
    const body = parseBody(issueCreateSchema, request.body);
    const actor = resolveRequestActor(db, request);
    const result = mutateWithPublish(db, bus, () =>
      createIssue(db, {
        project: body.project,
        title: body.title,
        description: body.description,
        stage: body.stage,
        priority: body.priority,
        assignee: body.assignee ?? undefined,
        module: body.module ?? undefined,
        parent: body.parent ?? undefined,
        links: body.links?.map((link) => ({
          url: link.url,
          label: link.label ?? undefined,
        })),
        client_request_id: body.client_request_id,
        actor: actor.id,
      }),
    );
    response.status(result.created ? 201 : 200).json({
      ok: true,
      created: result.created,
      issue: result.issue,
    });
  });

  router.get('/issues/:key/activity', (request, response) => {
    const limit = queryNumber(request.query.limit) ?? 50;
    const before = queryNumber(request.query.before);
    response.json({
      ok: true,
      items: listIssueActivity(db, request.params.key, limit, before),
    });
  });

  router.get('/issues/:key/comments', (request, response) => {
    const limit = queryNumber(request.query.limit) ?? 50;
    const before = queryString(request.query.before);
    response.json({
      ok: true,
      items: listComments(db, request.params.key, limit, before),
    });
  });

  router.post('/issues/:key/comments', (request, response) => {
    const body = parseBody(commentCreateSchema, request.body);
    const actor = resolveRequestActor(db, request);
    const comment = mutateWithPublish(db, bus, () =>
      addComment(db, { issue: request.params.key, body: body.body, actor: actor.id }),
    );
    response.status(201).json({ ok: true, comment });
  });

  router.patch('/comments/:id', (request, response) => {
    const body = parseBody(commentUpdateSchema, request.body);
    const actor = resolveRequestActor(db, request);
    const comment = mutateWithPublish(db, bus, () =>
      updateComment(db, {
        comment_id: request.params.id,
        body: body.body,
        expected_rev: body.expected_rev,
        actor: actor.id,
      }),
    );
    response.json({ ok: true, comment });
  });

  router.delete('/comments/:id', (request, response) => {
    const actor = resolveRequestActor(db, request);
    mutateWithPublish(db, bus, () =>
      deleteComment(db, { comment_id: request.params.id, actor: actor.id }),
    );
    response.json({ ok: true });
  });

  router.post('/issues/:key/links', (request, response) => {
    const body = parseBody(linkCreateSchema, request.body);
    const actor = resolveRequestActor(db, request);
    const link = mutateWithPublish(db, bus, () =>
      addLink(db, {
        issue: request.params.key,
        url: body.url,
        label: body.label ?? null,
        actor: actor.id,
      }),
    );
    response.status(201).json({ ok: true, link });
  });

  router.delete('/links/:id', (request, response) => {
    const link = findLinkRow(db, request.params.id);
    if (!link) throw new DomainError('not_found', `Link not found: ${request.params.id}`);
    const actor = resolveRequestActor(db, request);
    mutateWithPublish(db, bus, () =>
      removeLink(db, {
        issue: link.issue_id,
        link_id: link.id,
        actor: actor.id,
      }),
    );
    response.json({ ok: true });
  });

  router.get('/issues/:key', (request, response) => {
    const activityLimit = queryNumber(request.query.activity_limit);
    const commentLimit = queryNumber(request.query.comment_limit);
    response.json({
      ok: true,
      issue: getIssue(db, request.params.key, { activityLimit, commentLimit }),
    });
  });

  router.patch('/issues/:key', (request, response) => {
    const body = parseBody(issueUpdateSchema, request.body);
    const actor = resolveRequestActor(db, request);
    const result = mutateWithPublish(db, bus, () =>
      updateIssue(db, {
        issue: request.params.key,
        expected_rev: body.expected_rev,
        title: body.title,
        description: body.description,
        priority: body.priority,
        assignee: body.assignee,
        module: body.module,
        parent: body.parent,
        actor: actor.id,
      }),
    );
    response.json({ ok: true, changed: result.changed, issue: result.issue });
  });

  router.delete('/issues/:key', (request, response) => {
    const body = parseBody(deleteSchema, request.body ?? {});
    const expectedRev =
      queryNumber(request.query.expected_rev) ?? body.expected_rev;
    if (expectedRev === undefined) {
      throw new DomainError('validation_error', 'expected_rev is required');
    }
    const cascade = queryBoolean(request.query.cascade) ?? body.cascade ?? false;
    const reason = queryString(request.query.reason) ?? body.reason;
    const actor = resolveRequestActor(db, request);
    const result = mutateWithPublish(db, bus, () =>
      deleteIssue(db, {
        issue: request.params.key,
        expected_rev: expectedRev,
        cascade,
        reason,
        actor: actor.id,
      }),
    );
    response.json({ ok: true, ...result });
  });

  router.post('/issues/:key/move', (request, response) => {
    const body = parseBody(issueMoveSchema, request.body);
    const actor = resolveRequestActor(db, request);
    const result = mutateWithPublish(db, bus, () =>
      moveIssue(db, {
        issue: request.params.key,
        expected_rev: body.expected_rev,
        stage: body.stage,
        position: body.position,
        actor: actor.id,
      }),
    );
    response.json({ ok: true, changed: result.changed, issue: result.issue });
  });

  router.post('/issues/:key/claim', (request, response) => {
    const body = parseBody(claimSchema, request.body ?? {});
    const actor = resolveRequestActor(db, request);
    const result = mutateWithPublish(db, bus, () =>
      claimIssue(db, {
        issue: request.params.key,
        expected_rev: body.expected_rev,
        actor: actor.id,
      }),
    );
    response.json({ ok: true, claimed: result.claimed, already_owned: result.already_owned, issue: result.issue });
  });

  router.post('/issues/:key/release', (request, response) => {
    parseBody(releaseSchema, request.body ?? {});
    const actor = resolveRequestActor(db, request);
    const result = mutateWithPublish(db, bus, () =>
      releaseIssue(db, { issue: request.params.key, actor: actor.id }),
    );
    response.json({ ok: true, released: result.released, issue: result.issue });
  });

  router.post('/issues/:key/block', (request, response) => {
    const body = parseBody(blockSchema, request.body);
    const actor = resolveRequestActor(db, request);
    const result = mutateWithPublish(db, bus, () =>
      blockIssue(db, {
        issue: request.params.key,
        expected_rev: body.expected_rev,
        reason: body.reason,
        actor: actor.id,
      }),
    );
    response.json({ ok: true, changed: result.changed, issue: result.issue });
  });

  router.post('/issues/:key/unblock', (request, response) => {
    const body = parseBody(unblockSchema, request.body);
    const actor = resolveRequestActor(db, request);
    const result = mutateWithPublish(db, bus, () =>
      unblockIssue(db, {
        issue: request.params.key,
        expected_rev: body.expected_rev,
        actor: actor.id,
      }),
    );
    response.json({ ok: true, changed: result.changed, issue: result.issue });
  });

  router.post('/issues/:key/restore', (request, response) => {
    const actor = resolveRequestActor(db, request);
    const result = mutateWithPublish(db, bus, () =>
      restoreIssue(db, { issue: request.params.key, actor: actor.id }),
    );
    response.json({ ok: true, ...result });
  });

  return router;
}
