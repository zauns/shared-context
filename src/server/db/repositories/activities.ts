import type { Database } from '../connection.js';
import type { ActivityRow } from './rows.js';

export interface NewActivity {
  project_id: string;
  issue_id: string;
  actor_id: string | null;
  actor_name: string;
  type: string;
  changes_json: string;
  created_at: string;
}

export function insertActivityRow(db: Database, activity: NewActivity): number {
  const result = db.prepare(
    `INSERT INTO activities
       (project_id, issue_id, actor_id, actor_name, type, changes_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    activity.project_id,
    activity.issue_id,
    activity.actor_id,
    activity.actor_name,
    activity.type,
    activity.changes_json,
    activity.created_at,
  );
  return Number(result.lastInsertRowid);
}

export function listIssueActivityRows(
  db: Database,
  issueId: string,
  limit: number,
  beforeId?: number,
): ActivityRow[] {
  const rows = beforeId
    ? db
        .prepare(
          `SELECT * FROM activities
           WHERE issue_id = ? AND id < ?
           ORDER BY id DESC LIMIT ?`,
        )
        .all(issueId, beforeId, limit)
    : db
        .prepare(
          `SELECT * FROM activities
           WHERE issue_id = ?
           ORDER BY id DESC LIMIT ?`,
        )
        .all(issueId, limit);
  return rows as unknown as ActivityRow[];
}

export function listProjectActivityRows(
  db: Database,
  projectId: string,
  limit: number,
  beforeId?: number,
): ActivityRow[] {
  const rows = beforeId
    ? db
        .prepare(
          `SELECT * FROM activities
           WHERE project_id = ? AND id < ?
           ORDER BY id DESC LIMIT ?`,
        )
        .all(projectId, beforeId, limit)
    : db
        .prepare(
          `SELECT * FROM activities
           WHERE project_id = ?
           ORDER BY id DESC LIMIT ?`,
        )
        .all(projectId, limit);
  return rows as unknown as ActivityRow[];
}

export function currentActivityCursor(db: Database): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(id), 0) AS cursor FROM activities')
    .get() as unknown as { cursor: number };
  return row.cursor;
}

export function activityRowsAfter(
  db: Database,
  since: number,
  projectId: string | undefined,
  limit: number,
): ActivityRow[] {
  const rows = projectId
    ? db
        .prepare(
          `SELECT * FROM activities
           WHERE id > ? AND project_id = ?
           ORDER BY id ASC LIMIT ?`,
        )
        .all(since, projectId, limit)
    : db
        .prepare(
          `SELECT * FROM activities
           WHERE id > ?
           ORDER BY id ASC LIMIT ?`,
        )
        .all(since, limit);
  return rows as unknown as ActivityRow[];
}
