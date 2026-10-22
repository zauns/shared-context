import type { Database } from '../connection.js';
import type { CommentRow } from './rows.js';

export function insertCommentRow(db: Database, row: CommentRow): void {
  db.prepare(
    `INSERT INTO comments
       (id, issue_id, body, author_id, rev, created_at, updated_at, deleted_at, deleted_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.issue_id,
    row.body,
    row.author_id,
    row.rev,
    row.created_at,
    row.updated_at,
    row.deleted_at,
    row.deleted_by,
  );
}

export function findCommentRow(db: Database, id: string): CommentRow | undefined {
  return db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as unknown as
    | CommentRow
    | undefined;
}

export function listCommentRows(
  db: Database,
  issueId: string,
  limit: number,
  before?: string,
): CommentRow[] {
  const rows = before
    ? db
        .prepare(
          `SELECT * FROM comments
           WHERE issue_id = ? AND deleted_at IS NULL AND created_at < ?
           ORDER BY created_at ASC, id ASC LIMIT ?`,
        )
        .all(issueId, before, limit)
    : db
        .prepare(
          `SELECT * FROM comments
           WHERE issue_id = ? AND deleted_at IS NULL
           ORDER BY created_at ASC, id ASC LIMIT ?`,
        )
        .all(issueId, limit);
  return rows as unknown as CommentRow[];
}

export function updateCommentRow(
  db: Database,
  id: string,
  body: string,
  rev: number,
  updatedAt: string,
  expectedRev: number,
): number {
  const result = db
    .prepare(
      `UPDATE comments
       SET body = ?, rev = ?, updated_at = ?
       WHERE id = ? AND rev = ? AND deleted_at IS NULL`,
    )
    .run(body, rev, updatedAt, id, expectedRev);
  return Number(result.changes);
}

export function softDeleteCommentRow(
  db: Database,
  id: string,
  deletedAt: string,
  deletedBy: string,
): number {
  const result = db
    .prepare(
      `UPDATE comments
       SET deleted_at = ?, deleted_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(deletedAt, deletedBy, id);
  return Number(result.changes);
}
