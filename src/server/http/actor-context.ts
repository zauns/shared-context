import type { Request } from 'express';
import type { Database } from '../db/connection.js';
import { findActorRow } from '../db/repositories/actors.js';
import { requireActorRow } from '../domain/actors.js';
import { DomainError } from '../domain/errors.js';
import type { ActorRow } from '../db/repositories/rows.js';

export function ownerActorRow(db: Database): ActorRow | undefined {
  const row = db
    .prepare(
      `SELECT * FROM actors
       WHERE kind = 'human'
       ORDER BY created_at, id
       LIMIT 1`,
    )
    .get() as unknown as ActorRow | undefined;
  return row;
}

export function resolveRequestActor(db: Database, request: Request): ActorRow {
  const header = request.header('x-actor');
  if (header) {
    const actor = findActorRow(db, header);
    if (!actor) {
      throw new DomainError('actor_not_found', `Actor not found: ${header}`);
    }
    return actor;
  }
  const owner = ownerActorRow(db);
  if (!owner) {
    throw new DomainError(
      'actor_required',
      'Run setup or create a human Actor before mutating Issues',
    );
  }
  return requireActorRow(db, owner.id);
}

export function optionalActorId(db: Database, request: Request): string | undefined {
  const header = request.header('x-actor');
  if (header) {
    return findActorRow(db, header)?.id;
  }
  return ownerActorRow(db)?.id;
}
