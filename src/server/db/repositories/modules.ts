import type { Database } from '../connection.js';
import type { ModuleRow } from './rows.js';

export function findModuleRow(
  db: Database,
  projectId: string,
  ref: string,
): ModuleRow | undefined {
  return db
    .prepare(
      `SELECT * FROM modules
       WHERE project_id = ?
         AND (id = ? OR slug = ? OR lower(name) = lower(?))`,
    )
    .get(projectId, ref, ref.toLowerCase(), ref) as unknown as ModuleRow | undefined;
}

export function findModuleById(db: Database, id: string): ModuleRow | undefined {
  return db.prepare('SELECT * FROM modules WHERE id = ?').get(id) as unknown as
    | ModuleRow
    | undefined;
}

export function listModuleRows(db: Database, projectId: string): ModuleRow[] {
  return db
    .prepare('SELECT * FROM modules WHERE project_id = ? ORDER BY name COLLATE NOCASE')
    .all(projectId) as unknown as ModuleRow[];
}

export function insertModuleRow(db: Database, row: ModuleRow): void {
  db.prepare(
    `INSERT INTO modules (id, project_id, name, slug, color, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.project_id, row.name, row.slug, row.color, row.created_at);
}

export function updateModuleRow(
  db: Database,
  id: string,
  fields: { name?: string; color?: string | null },
): number {
  const columns: string[] = [];
  const params: (string | number | null)[] = [];
  if (fields.name !== undefined) {
    columns.push('name = ?');
    params.push(fields.name);
  }
  if (fields.color !== undefined) {
    columns.push('color = ?');
    params.push(fields.color);
  }
  if (columns.length === 0) return 0;
  params.push(id);
  const result = db.prepare(`UPDATE modules SET ${columns.join(', ')} WHERE id = ?`).run(...params);
  return Number(result.changes);
}

export function deleteModuleRow(db: Database, id: string): void {
  db.prepare('DELETE FROM modules WHERE id = ?').run(id);
}

export function countModuleIssues(db: Database, moduleId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM issues
       WHERE module_id = ? AND deleted_at IS NULL`,
    )
    .get(moduleId) as unknown as { count: number };
  return row.count;
}
