import type { Database } from '../connection.js';
import type { IssueRow } from './rows.js';

export interface IssueCursor {
  sort: 'updated' | 'priority' | 'position';
  updated_at?: string;
  position?: number;
  priority_rank?: number;
  id: string;
}

export interface IssueQuery {
  projectId: string;
  q?: string;
  stages?: string[];
  priorities?: string[];
  assigneeId?: string;
  moduleId?: string;
  parentId?: string;
  blocked?: boolean;
  hasAttachments?: boolean;
  updatedSince?: string;
  includeDeleted?: boolean;
  limit: number;
  cursor?: IssueCursor | null;
  sort: 'updated' | 'priority' | 'position';
}

type SqlValue = string | number | bigint | null | Uint8Array;

const PRIORITY_RANK_SQL = `CASE i.priority
  WHEN 'urgent' THEN 4
  WHEN 'high' THEN 3
  WHEN 'medium' THEN 2
  WHEN 'low' THEN 1
  ELSE 0
END`;

function buildWhere(query: IssueQuery): {
  from: string;
  where: string;
  params: SqlValue[];
} {
  const from = query.q
    ? 'issues_fts f JOIN issues i ON i.rowid = f.rowid'
    : 'issues i';
  const where: string[] = ['i.project_id = ?'];
  const params: SqlValue[] = [query.projectId];

  if (query.q) {
    where.push('issues_fts MATCH ?');
    params.push(query.q);
  }
  if (!query.includeDeleted) {
    where.push('i.deleted_at IS NULL');
  }
  if (query.stages && query.stages.length > 0) {
    where.push(`i.stage IN (${query.stages.map(() => '?').join(', ')})`);
    params.push(...query.stages);
  }
  if (query.priorities && query.priorities.length > 0) {
    where.push(`i.priority IN (${query.priorities.map(() => '?').join(', ')})`);
    params.push(...query.priorities);
  }
  if (query.assigneeId) {
    where.push('i.assignee_id = ?');
    params.push(query.assigneeId);
  }
  if (query.moduleId) {
    where.push('i.module_id = ?');
    params.push(query.moduleId);
  }
  if (query.parentId) {
    where.push('i.parent_id = ?');
    params.push(query.parentId);
  }
  if (query.blocked !== undefined) {
    where.push('i.blocked = ?');
    params.push(query.blocked ? 1 : 0);
  }
  if (query.hasAttachments !== undefined) {
    where.push(
      query.hasAttachments
        ? 'EXISTS (SELECT 1 FROM attachments a WHERE a.issue_id = i.id AND a.deleted_at IS NULL)'
        : 'NOT EXISTS (SELECT 1 FROM attachments a WHERE a.issue_id = i.id AND a.deleted_at IS NULL)',
    );
  }
  if (query.updatedSince) {
    where.push('i.updated_at >= ?');
    params.push(query.updatedSince);
  }

  const cursor = query.cursor;
  if (cursor && !query.q) {
    if (cursor.sort === 'updated') {
      where.push('(i.updated_at < ? OR (i.updated_at = ? AND i.id < ?))');
      params.push(cursor.updated_at ?? '', cursor.updated_at ?? '', cursor.id);
    } else if (cursor.sort === 'position') {
      where.push('(i.position > ? OR (i.position = ? AND i.id > ?))');
      params.push(cursor.position ?? 0, cursor.position ?? 0, cursor.id);
    } else {
      where.push(
        `(${PRIORITY_RANK_SQL} < ? OR (${PRIORITY_RANK_SQL} = ? AND (i.updated_at < ? OR (i.updated_at = ? AND i.id < ?))))`,
      );
      params.push(
        cursor.priority_rank ?? 0,
        cursor.priority_rank ?? 0,
        cursor.updated_at ?? '',
        cursor.updated_at ?? '',
        cursor.id,
      );
    }
  }

  return { from, where: where.join(' AND '), params };
}

function orderBy(query: IssueQuery): string {
  if (query.q) {
    return 'bm25(issues_fts), i.updated_at DESC, i.id DESC';
  }
  if (query.sort === 'position') {
    return 'i.position ASC, i.id ASC';
  }
  if (query.sort === 'priority') {
    return `${PRIORITY_RANK_SQL} DESC, i.updated_at DESC, i.id DESC`;
  }
  return 'i.updated_at DESC, i.id DESC';
}

export function findIssueRow(
  db: Database,
  ref: string,
  includeDeleted = false,
): IssueRow | undefined {
  const deletedClause = includeDeleted ? '' : ' AND deleted_at IS NULL';
  return db
    .prepare(`SELECT * FROM issues WHERE (id = ? OR key = ?)${deletedClause}`)
    .get(ref, ref.toUpperCase()) as unknown as IssueRow | undefined;
}

export function findIssueById(db: Database, id: string): IssueRow | undefined {
  return db.prepare('SELECT * FROM issues WHERE id = ?').get(id) as unknown as
    | IssueRow
    | undefined;
}

export function findIssueByClientRequestId(
  db: Database,
  projectId: string,
  clientRequestId: string,
): IssueRow | undefined {
  return db
    .prepare(
      `SELECT * FROM issues
       WHERE project_id = ? AND client_request_id = ?`,
    )
    .get(projectId, clientRequestId) as unknown as IssueRow | undefined;
}

export function listIssueRows(db: Database, query: IssueQuery): IssueRow[] {
  const { from, where, params } = buildWhere(query);
  const sql = `SELECT i.* FROM ${from} WHERE ${where} ORDER BY ${orderBy(query)} LIMIT ?`;
  return db
    .prepare(sql)
    .all(...params, query.limit) as unknown as IssueRow[];
}

export function countIssueRows(db: Database, query: IssueQuery): number {
  const { from, where, params } = buildWhere({ ...query, cursor: null });
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM ${from} WHERE ${where}`)
    .get(...params) as unknown as { count: number };
  return row.count;
}

export function insertIssueRow(db: Database, row: IssueRow): void {
  db.prepare(
    `INSERT INTO issues
       (id, project_id, number, key, title, description, stage, priority,
        assignee_id, module_id, parent_id, blocked, blocked_reason, blocked_at,
        blocked_by, position, rev, created_by, created_at, updated_at,
        completed_at, cancelled_at, deleted_at, deleted_by, deletion_batch,
        client_request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.project_id,
    row.number,
    row.key,
    row.title,
    row.description,
    row.stage,
    row.priority,
    row.assignee_id,
    row.module_id,
    row.parent_id,
    row.blocked,
    row.blocked_reason,
    row.blocked_at,
    row.blocked_by,
    row.position,
    row.rev,
    row.created_by,
    row.created_at,
    row.updated_at,
    row.completed_at,
    row.cancelled_at,
    row.deleted_at,
    row.deleted_by,
    row.deletion_batch,
    row.client_request_id,
  );
}

export function updateIssueRow(
  db: Database,
  id: string,
  fields: Partial<
    Pick<
      IssueRow,
      | 'title'
      | 'description'
      | 'stage'
      | 'priority'
      | 'assignee_id'
      | 'module_id'
      | 'parent_id'
      | 'blocked'
      | 'blocked_reason'
      | 'blocked_at'
      | 'blocked_by'
      | 'position'
      | 'rev'
      | 'updated_at'
      | 'completed_at'
      | 'cancelled_at'
      | 'deleted_at'
      | 'deleted_by'
      | 'deletion_batch'
      | 'client_request_id'
    >
  >,
  expectedRev?: number,
): number {
  const columns: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(fields)) {
    columns.push(`${key} = ?`);
    params.push(value as string | number | null);
  }
  if (columns.length === 0) return 0;
  params.push(id);
  let sql = `UPDATE issues SET ${columns.join(', ')} WHERE id = ?`;
  if (expectedRev !== undefined) {
    sql += ' AND rev = ?';
    params.push(expectedRev);
  }
  const result = db.prepare(sql).run(...params);
  return Number(result.changes);
}

export function allocateIssueNumber(db: Database, projectId: string, now: string): number {
  const row = db
    .prepare(
      `UPDATE projects
       SET next_issue_number = next_issue_number + 1, updated_at = ?
       WHERE id = ?
       RETURNING next_issue_number - 1 AS number`,
    )
    .get(now, projectId) as unknown as { number: number };
  return row.number;
}

export function nextPosition(db: Database, projectId: string, stage: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(position), 0) + 1024 AS position
       FROM issues
       WHERE project_id = ? AND stage = ? AND deleted_at IS NULL`,
    )
    .get(projectId, stage) as unknown as { position: number };
  return row.position;
}

export function listChildRows(db: Database, parentId: string): IssueRow[] {
  return db
    .prepare(
      `SELECT * FROM issues
       WHERE parent_id = ? AND deleted_at IS NULL
       ORDER BY position, id`,
    )
    .all(parentId) as unknown as IssueRow[];
}

export function countActiveChildren(db: Database, parentId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM issues
       WHERE parent_id = ? AND deleted_at IS NULL`,
    )
    .get(parentId) as unknown as { count: number };
  return row.count;
}

export function progressForParent(
  db: Database,
  parentId: string,
): { done: number; active: number; cancelled: number; total: number } {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN stage = 'done' THEN 1 ELSE 0 END), 0) AS done,
         COALESCE(SUM(CASE WHEN stage NOT IN ('done', 'cancelled') THEN 1 ELSE 0 END), 0) AS active,
         COALESCE(SUM(CASE WHEN stage = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled
       FROM issues
       WHERE parent_id = ? AND deleted_at IS NULL`,
    )
    .get(parentId) as unknown as {
    done: number;
    active: number;
    cancelled: number;
  };
  return { ...row, total: row.done + row.active };
}

export function listSubtreeRows(
  db: Database,
  rootId: string,
  cascade: boolean,
): { id: string; key: string; title: string; parent_id: string | null }[] {
  if (!cascade) {
    const row = db
      .prepare('SELECT id, key, title, parent_id FROM issues WHERE id = ? AND deleted_at IS NULL')
      .get(rootId) as unknown as
      | { id: string; key: string; title: string; parent_id: string | null }
      | undefined;
    return row ? [row] : [];
  }
  return db
    .prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM issues WHERE id = ? AND deleted_at IS NULL
         UNION ALL
         SELECT i.id FROM issues i JOIN subtree s ON i.parent_id = s.id
         WHERE i.deleted_at IS NULL
       )
       SELECT id, key, title, parent_id FROM issues WHERE id IN (SELECT id FROM subtree)`,
    )
    .all(rootId) as unknown as { id: string; key: string; title: string; parent_id: string | null }[];
}

export function softDeleteRows(
  db: Database,
  ids: string[],
  actorId: string,
  batch: string,
  now: string,
): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(
    `UPDATE issues
     SET deleted_at = ?, deleted_by = ?, deletion_batch = ?,
         rev = rev + 1, updated_at = ?
     WHERE id IN (${placeholders})`,
  ).run(now, actorId, batch, now, ...ids);
}

export function restoreRows(db: Database, batch: string, now: string): void {
  db.prepare(
    `UPDATE issues
     SET deleted_at = NULL, deleted_by = NULL, deletion_batch = NULL,
         rev = rev + 1, updated_at = ?
     WHERE deletion_batch = ?`,
  ).run(now, batch);
}

export function rowsForBatch(
  db: Database,
  batch: string,
): { id: string; key: string; title: string; parent_id: string | null }[] {
  return db
    .prepare('SELECT id, key, title, parent_id FROM issues WHERE deletion_batch = ?')
    .all(batch) as unknown as {
    id: string;
    key: string;
    title: string;
    parent_id: string | null;
  }[];
}

export function countAttachments(db: Database, issueId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM attachments
       WHERE issue_id = ? AND deleted_at IS NULL`,
    )
    .get(issueId) as unknown as { count: number };
  return row.count;
}

export function countComments(db: Database, issueId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM comments
       WHERE issue_id = ? AND deleted_at IS NULL`,
    )
    .get(issueId) as unknown as { count: number };
  return row.count;
}
