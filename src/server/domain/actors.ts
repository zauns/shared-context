import type { Database } from '../db/connection.js';
import {
  findActorRow,
  insertActorRow,
  listActorRows,
  updateActorRow,
} from '../db/repositories/actors.js';
import type { ActorRow } from '../db/repositories/rows.js';
import { withImmediateTransaction } from '../db/connection.js';
import { DomainError, validationError } from './errors.js';
import { newId } from './ids.js';
import { nowIso } from './time.js';
import type { ActorKind, ActorRef } from './types.js';
import { assertNonEmpty, normalizeNameKey } from './validation.js';

export function actorRowToRef(row: ActorRow): ActorRef {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    can_read_images: row.can_read_images === 1,
    color: row.color,
  };
}

export function requireActorRow(db: Database, ref: string): ActorRow {
  const row = findActorRow(db, ref);
  if (!row) {
    throw new DomainError('actor_not_found', `Actor not found: ${ref}`);
  }
  return row;
}

export function getActorRef(db: Database, id: string): ActorRef | null {
  const row = findActorRow(db, id);
  return row ? actorRowToRef(row) : null;
}

export interface IdentifyActorInput {
  name: string;
  kind?: ActorKind;
  can_read_images?: boolean;
}

export function identifyActor(db: Database, input: IdentifyActorInput): ActorRef {
  const name = assertNonEmpty(input.name, 'actor', 64);
  const nameKey = normalizeNameKey(name);
  const now = nowIso();

  return withImmediateTransaction(db, () => {
    const existing = findActorRow(db, nameKey);
    if (existing) {
      updateActorRow(db, existing.id, {
        last_seen_at: now,
        ...(input.can_read_images === undefined
          ? {}
          : { can_read_images: input.can_read_images ? 1 : 0 }),
      });
      return actorRowToRef(findActorRow(db, existing.id) ?? existing);
    }

    const row: ActorRow = {
      id: newId(),
      name,
      name_key: nameKey,
      kind: input.kind ?? 'agent',
      can_read_images: input.can_read_images ? 1 : 0,
      color: null,
      created_at: now,
      last_seen_at: now,
    };
    insertActorRow(db, row);
    return actorRowToRef(row);
  });
}

export function listActors(db: Database): ActorRef[] {
  return listActorRows(db).map(actorRowToRef);
}

export interface UpdateActorInput {
  name?: string;
  can_read_images?: boolean;
  color?: string | null;
}

export function updateActor(db: Database, id: string, input: UpdateActorInput): ActorRef {
  const existing = requireActorRow(db, id);
  const fields: {
    name?: string;
    name_key?: string;
    can_read_images?: number;
    color?: string | null;
  } = {};

  if (input.name !== undefined) {
    const name = assertNonEmpty(input.name, 'actor', 64);
    fields.name = name;
    fields.name_key = normalizeNameKey(name);
  }
  if (input.can_read_images !== undefined) {
    fields.can_read_images = input.can_read_images ? 1 : 0;
  }
  if (input.color !== undefined) {
    fields.color = input.color;
  }

  try {
    updateActorRow(db, existing.id, fields);
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed')) {
      throw new DomainError('conflict', `Actor name already in use: ${input.name}`);
    }
    throw error;
  }
  return actorRowToRef(requireActorRow(db, existing.id));
}

export function requireHumanOrSelf(actor: ActorRow, ownerId: string | null): void {
  if (actor.kind !== 'human' && actor.id !== ownerId) {
    throw new DomainError('validation_error', 'Only the owner or a human Actor may do this');
  }
}

export function assertActorName(name: string): string {
  return assertNonEmpty(name, 'actor', 64);
}

export function invalidActorKind(kind: string): never {
  validationError(`Unknown actor kind: ${kind}`);
}
