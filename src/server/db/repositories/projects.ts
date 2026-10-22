import type { Database } from '../connection.js';
import type { ProjectRow } from './rows.js';
import {
  PRIORITIES,
  STAGES,
  type PriorityCounts,
  type StageCounts,
} from '../../domain/types.js';

export function findProjectRow(db: Database, ref: string): ProjectRow | undefined {
  return db
    .prepare('SELECT * FROM projects WHERE id = ? OR key = ?')
    .get(ref, ref.toUpperCase()) as unknown as ProjectRow | undefined;
}

export function listProjectRows(db: Database): ProjectRow[] {
  return db
    .prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE, key')
    .all() as unknown as ProjectRow[];
}

export function insertProjectRow(db: Database, row: ProjectRow): void {
  db.prepare(
    `INSERT INTO projects
       (id, key, name, description, root_path, doc_allowlist_json,
        next_issue_number, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.key,
    row.name,
    row.description,
    row.root_path,
    row.doc_allowlist_json,
    row.next_issue_number,
    row.created_at,
    row.updated_at,
  );
}

export function updateProjectRow(
  db: Database,
  id: string,
  fields: {
    name?: string;
    description?: string;
    root_path?: string | null;
    doc_allowlist_json?: string;
    updated_at: string;
  },
): number {
  const columns: string[] = [];
  const params: (string | number | null)[] = [];
  if (fields.name !== undefined) {
    columns.push('name = ?');
    params.push(fields.name);
  }
  if (fields.description !== undefined) {
    columns.push('description = ?');
    params.push(fields.description);
  }
  if (fields.root_path !== undefined) {
    columns.push('root_path = ?');
    params.push(fields.root_path);
  }
  if (fields.doc_allowlist_json !== undefined) {
    columns.push('doc_allowlist_json = ?');
    params.push(fields.doc_allowlist_json);
  }
  columns.push('updated_at = ?');
  params.push(fields.updated_at);
  params.push(id);
  const result = db
    .prepare(`UPDATE projects SET ${columns.join(', ')} WHERE id = ?`)
    .run(...params);
  return Number(result.changes);
}

export function countProjectIssues(db: Database, projectId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM issues WHERE project_id = ?')
    .get(projectId) as unknown as { count: number };
  return row.count;
}

export function deleteProjectRow(db: Database, id: string): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export function projectCounts(
  db: Database,
  projectId: string,
): {
  by_stage: StageCounts;
  by_priority: PriorityCounts;
  blocked: number;
  total: number;
} {
  const stageRows = db
    .prepare(
      `SELECT stage, COUNT(*) AS count
       FROM issues
       WHERE project_id = ? AND deleted_at IS NULL
       GROUP BY stage`,
    )
    .all(projectId) as unknown as { stage: string; count: number }[];

  const priorityRows = db
    .prepare(
      `SELECT priority, COUNT(*) AS count
       FROM issues
       WHERE project_id = ? AND deleted_at IS NULL
       GROUP BY priority`,
    )
    .all(projectId) as unknown as { priority: string; count: number }[];

  const blockedRow = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM issues
       WHERE project_id = ? AND deleted_at IS NULL AND blocked = 1`,
    )
    .get(projectId) as unknown as { count: number };

  const by_stage = Object.fromEntries(STAGES.map((stage) => [stage, 0])) as StageCounts;
  for (const row of stageRows) {
    if (row.stage in by_stage) by_stage[row.stage as keyof StageCounts] = row.count;
  }

  const by_priority = Object.fromEntries(PRIORITIES.map((priority) => [priority, 0])) as PriorityCounts;
  for (const row of priorityRows) {
    if (row.priority in by_priority) {
      by_priority[row.priority as keyof PriorityCounts] = row.count;
    }
  }

  const total = Object.values(by_stage).reduce((sum, count) => sum + count, 0);
  return { by_stage, by_priority, blocked: blockedRow.count, total };
}
