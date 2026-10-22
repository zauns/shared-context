import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '..');
const spec = fs.readFileSync(path.join(root, 'plan', '02-data-model.md'), 'utf8');

const sqlBlocks = [...spec.matchAll(/```sql\n([\s\S]*?)```/g)].map((match) => match[1]);
const ddl = sqlBlocks.filter((sql) =>
  /CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX|VIRTUAL\s+TABLE|TRIGGER)/i.test(sql),
);

function openSchema() {
  const db = new DatabaseSync(':memory:');
  for (const block of ddl) db.exec(block);
  return db;
}

function seed(db) {
  const now = '2026-01-01T00:00:00.000Z';
  db.prepare(
    `INSERT INTO projects (id, key, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('p1', 'SHC', 'Shared Context', now, now);
  db.prepare(
    `INSERT INTO actors (id, name, name_key, kind, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('a1', 'Owner', 'owner', 'human', now);
  db.prepare(
    `INSERT INTO issues
       (id, project_id, number, key, title, description, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('i1', 'p1', 1, 'SHC-1', 'Hello world', 'Initial body', 'a1', now, now);
  return now;
}

test('v1 schema applies and enforces the core constraints', () => {
  const db = openSchema();

  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name`)
    .all()
    .map((row) => row.name);
  for (const table of [
    'projects', 'modules', 'actors', 'issues', 'issue_links',
    'attachments', 'comments', 'activities', 'issues_fts',
  ]) {
    assert.ok(tables.includes(table), `missing table: ${table}`);
  }

  const now = seed(db);

  const found = db
    .prepare(`SELECT issues.key FROM issues_fts JOIN issues ON issues.rowid = issues_fts.rowid WHERE issues_fts MATCH 'hello'`)
    .all();
  assert.equal(found.length, 1, 'FTS insert trigger did not index the title');

  db.prepare(`UPDATE issues SET title = ? WHERE id = 'i1'`).run('Changed title');
  assert.equal(
    db.prepare(`SELECT issues.key FROM issues_fts JOIN issues ON issues.rowid = issues_fts.rowid WHERE issues_fts MATCH 'changed'`).all().length,
    1,
    'FTS update trigger did not index the new title',
  );
  assert.equal(
    db.prepare(`SELECT issues.key FROM issues_fts JOIN issues ON issues.rowid = issues_fts.rowid WHERE issues_fts MATCH 'hello'`).all().length,
    0,
    'FTS update trigger did not remove the old title',
  );

  assert.throws(
    () => db.prepare(`UPDATE issues SET stage = 'blocked' WHERE id = 'i1'`).run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare(`UPDATE issues SET blocked = 1 WHERE id = 'i1'`).run(),
    /CHECK constraint failed/,
  );
  db.prepare(
    `UPDATE issues SET blocked = 1, blocked_reason = ?, blocked_at = ? WHERE id = 'i1'`,
  ).run('waiting on review', now);
  assert.throws(
    () => db.prepare(`UPDATE issues SET blocked = 0 WHERE id = 'i1'`).run(),
    /CHECK constraint failed/,
  );

  assert.throws(
    () => db.prepare(
      `INSERT INTO projects (id, key, name, created_at, updated_at)
       VALUES ('p2', 'shc', 'Lowercase', ?, ?)`,
    ).run(now, now),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare(`UPDATE projects SET key = 'OTHER' WHERE id = 'p1'`).run(),
    /project key is immutable/,
  );
  assert.throws(
    () => db.prepare(`UPDATE issues SET key = 'SHC-99' WHERE id = 'i1'`).run(),
    /issue identity is immutable/,
  );

  db.prepare(
    `INSERT INTO activities
       (project_id, issue_id, actor_id, actor_name, type, changes_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('p1', 'i1', 'a1', 'Owner', 'issue.created', '[]', now);
  const activity = db.prepare(`SELECT id FROM activities`).get();
  assert.throws(
    () => db.prepare(`UPDATE activities SET type = 'x' WHERE id = ?`).run(activity.id),
    /activities are append-only/,
  );
  assert.throws(
    () => db.prepare(`DELETE FROM activities WHERE id = ?`).run(activity.id),
    /activities are append-only/,
  );

  db.prepare(`UPDATE issues SET deleted_at = ?, deletion_batch = ? WHERE id = 'i1'`).run(now, 'batch-1');
  assert.equal(
    db.prepare(`SELECT issues.key FROM issues_fts JOIN issues ON issues.rowid = issues_fts.rowid WHERE issues_fts MATCH 'changed' AND issues.deleted_at IS NULL`).all().length,
    0,
    'soft-deleted issues must not appear in active search results',
  );

  db.close();
});
