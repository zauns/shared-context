import type { Database } from '../connection.js';
import type { ActorRow } from './rows.js';

export function findActorRow(db: Database, ref: string): ActorRow | undefined {
  return db
    .prepare('SELECT * FROM actors WHERE id = ? OR name_key = ?')
    .get(ref, ref.trim().toLowerCase()) as unknown as ActorRow | undefined;
}

export function listActorRows(db: Database): ActorRow[] {
  return db
    .prepare('SELECT * FROM actors ORDER BY kind, name COLLATE NOCASE')
    .all() as unknown as ActorRow[];
}

export function insertActorRow(db: Database, row: ActorRow): void {
  db.prepare(
    `INSERT INTO actors
       (id, name, name_key, kind, can_read_images, color, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.name,
    row.name_key,
    row.kind,
    row.can_read_images,
    row.color,
    row.created_at,
    row.last_seen_at,
  );
}

export function updateActorRow(
  db: Database,
  id: string,
  fields: {
    name?: string;
    name_key?: string;
    can_read_images?: number;
    color?: string | null;
    last_seen_at?: string;
  },
): number {
  const columns: string[] = [];
  const params: (string | number | null)[] = [];
  if (fields.name !== undefined) {
    columns.push('name = ?');
    params.push(fields.name);
  }
  if (fields.name_key !== undefined) {
    columns.push('name_key = ?');
    params.push(fields.name_key);
  }
  if (fields.can_read_images !== undefined) {
    columns.push('can_read_images = ?');
    params.push(fields.can_read_images);
  }
  if (fields.color !== undefined) {
    columns.push('color = ?');
    params.push(fields.color);
  }
  if (fields.last_seen_at !== undefined) {
    columns.push('last_seen_at = ?');
    params.push(fields.last_seen_at);
  }
  if (columns.length === 0) return 0;
  params.push(id);
  const result = db.prepare(`UPDATE actors SET ${columns.join(', ')} WHERE id = ?`).run(...params);
  return Number(result.changes);
}
