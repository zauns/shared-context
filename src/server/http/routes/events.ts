import { Router } from 'express';
import type { Database } from '../../db/connection.js';
import {
  activityRowToEvent,
  currentActivityCursor,
} from '../../domain/activity.js';
import { DomainError } from '../../domain/errors.js';
import { findProjectRow } from '../../db/repositories/projects.js';
import { activityRowsAfter } from '../../db/repositories/activities.js';
import type { ChangeBus } from '../../services/change-bus.js';
import type { ActivityEvent } from '../../domain/types.js';

export interface EventsRouterDeps {
  db: Database;
  bus: ChangeBus;
}

function writeEvent(
  response: import('express').Response,
  event: ActivityEvent,
): void {
  response.write(`id: ${event.id}\n`);
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function createEventsRouter({ db, bus }: EventsRouterDeps): Router {
  const router = Router();

  router.get('/events', (request, response) => {
    const projectRef =
      typeof request.query.project === 'string' ? request.query.project : undefined;
    const project = projectRef ? findProjectRow(db, projectRef) : undefined;
    if (projectRef && !project) {
      throw new DomainError('not_found', `Project not found: ${projectRef}`);
    }

    const headerSince = request.header('last-event-id');
    const querySince = typeof request.query.since === 'string' ? request.query.since : undefined;
    const rawSince = headerSince ?? querySince;
    const current = currentActivityCursor(db);
    let since = current;
    if (rawSince !== undefined) {
      const parsed = Number(rawSince);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new DomainError('validation_error', 'since must be a non-negative integer');
      }
      if (parsed > current) {
        throw new DomainError('cursor_invalid', 'since is beyond the current activity cursor');
      }
      since = parsed;
    }

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();

    const replay = activityRowsAfter(db, since, project?.id, 1001);
    if (replay.length > 1000) {
      response.write('event: resync\n');
      response.write(`data: ${JSON.stringify({ cursor: current })}\n\n`);
      since = current;
    } else {
      for (const row of replay) {
        const event = activityRowToEvent(db, row);
        writeEvent(response, event);
        since = event.id;
      }
    }

    const unsubscribe = bus.subscribe((event) => {
      if (project && event.project_id !== project.id) return;
      if (event.id <= since) return;
      writeEvent(response, event);
      since = event.id;
    });

    const heartbeat = setInterval(() => {
      response.write(': ping\n\n');
    }, 15_000);
    heartbeat.unref?.();

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.on('close', cleanup);
    request.on('error', cleanup);
    response.on('close', cleanup);
  });

  return router;
}
