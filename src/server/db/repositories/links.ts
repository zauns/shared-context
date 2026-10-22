import type { Database } from '../connection.js';
import type { LinkRow } from './rows.js';

export function insertLinkRow(db: Database, row: LinkRow): void {
  db.prepare(
    `INSERT INTO issue_links (id, issue_id, url, label, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.issue_id, row.url, row.label, row.created_by, row.created_at);
}

export function findLinkRow(db: Database, id: string): LinkRow | undefined {
  return db.prepare('SELECT * FROM issue_links WHERE id = ?').get(id) as unknown as
    | LinkRow
    | undefined;
}

export function listLinkRows(db: Database, issueId: string): LinkRow[] {
  return db
    .prepare('SELECT * FROM issue_links WHERE issue_id = ? ORDER BY created_at, id')
    .all(issueId) as unknown as LinkRow[];
}

export function countLinkRows(db: Database, issueId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM issue_links WHERE issue_id = ?')
    .get(issueId) as unknown as { count: number };
  return row.count;
}

export function deleteLinkRow(db: Database, id: string): void {
  db.prepare('DELETE FROM issue_links WHERE id = ?').run(id);
}
