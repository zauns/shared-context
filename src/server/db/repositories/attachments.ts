import type { Database } from '../connection.js';
import type { AttachmentRow } from './rows.js';

export function insertAttachmentRow(db: Database, row: AttachmentRow): void {
  db.prepare(
    `INSERT INTO attachments
       (id, issue_id, original_name, stored_path, mime_type, size_bytes,
        sha256, text_path, created_by, created_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.issue_id,
    row.original_name,
    row.stored_path,
    row.mime_type,
    row.size_bytes,
    row.sha256,
    row.text_path,
    row.created_by,
    row.created_at,
    row.deleted_at,
  );
}

export function findAttachmentRow(db: Database, id: string): AttachmentRow | undefined {
  return db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as unknown as
    | AttachmentRow
    | undefined;
}

export function findActiveAttachmentBySha(
  db: Database,
  issueId: string,
  sha256: string,
): AttachmentRow | undefined {
  return db
    .prepare(
      `SELECT * FROM attachments
       WHERE issue_id = ? AND sha256 = ? AND deleted_at IS NULL`,
    )
    .get(issueId, sha256) as unknown as AttachmentRow | undefined;
}

export function listAttachmentRows(db: Database, issueId: string): AttachmentRow[] {
  return db
    .prepare(
      `SELECT * FROM attachments
       WHERE issue_id = ? AND deleted_at IS NULL
       ORDER BY created_at, id`,
    )
    .all(issueId) as unknown as AttachmentRow[];
}

export function softDeleteAttachmentRow(
  db: Database,
  id: string,
  deletedAt: string,
): number {
  const result = db
    .prepare('UPDATE attachments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(deletedAt, id);
  return Number(result.changes);
}
