# 02 — Data Model

**Status:** specified
**Depends on:** [00-overview](00-overview.md), [03-concurrency](03-concurrency.md)
**Feeds:** M1

## Storage

- One SQLite database: `%LOCALAPPDATA%\shared-context\data\shared-context.db`.
- WAL mode, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- One process writes; no cross-process writers.
- Timestamps are ISO 8601 UTC strings with `Z`; lexical order matches chronological order.
- IDs are UUIDv7 strings except `activities.id`, which is an integer cursor.
- `node:sqlite` `DatabaseSync`; statements are synchronous. Do not `await` inside a transaction.

## Enums

```text
stage:    backlog | todo | in_progress | review | done | cancelled
priority: urgent | high | medium | low | none
actor:    human | agent
activity: issue.created, issue.updated, issue.moved, issue.claimed,
          issue.released, issue.blocked, issue.unblocked, issue.deleted,
          issue.restored, parent.changed, attachment.added, attachment.removed,
          link.added, link.removed, comment.added, comment.updated, comment.deleted
```

`blocked` is not a Stage. It is a flag with a required reason.

## Schema (v1)

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE
    CHECK (
      key GLOB '[A-Z]*'
      AND key NOT GLOB '*[^A-Z0-9]*'
      AND length(key) BETWEEN 2 AND 6
    ),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 65536),
  root_path TEXT,
  doc_allowlist_json TEXT NOT NULL DEFAULT
    '["AGENTS.md","CONTEXT.md","README.md","docs/**/*.md","docs/**/*.txt"]',
  next_issue_number INTEGER NOT NULL DEFAULT 1 CHECK (next_issue_number >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE modules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 64),
  slug TEXT NOT NULL CHECK (length(slug) BETWEEN 1 AND 64),
  color TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, slug)
);

CREATE TABLE actors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 64),
  name_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
  can_read_images INTEGER NOT NULL DEFAULT 0 CHECK (can_read_images IN (0, 1)),
  color TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  number INTEGER NOT NULL CHECK (number >= 1),
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 262144),
  stage TEXT NOT NULL DEFAULT 'backlog'
    CHECK (stage IN ('backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'none'
    CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none')),
  assignee_id TEXT REFERENCES actors(id) ON DELETE SET NULL,
  module_id TEXT REFERENCES modules(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
  blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
  blocked_reason TEXT CHECK (blocked_reason IS NULL OR length(blocked_reason) <= 2000),
  blocked_at TEXT,
  blocked_by TEXT REFERENCES actors(id) ON DELETE SET NULL,
  position REAL NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev >= 1),
  created_by TEXT NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  cancelled_at TEXT,
  deleted_at TEXT,
  deleted_by TEXT REFERENCES actors(id) ON DELETE SET NULL,
  deletion_batch TEXT,
  client_request_id TEXT
    CHECK (client_request_id IS NULL OR length(client_request_id) BETWEEN 1 AND 128),
  CHECK (parent_id IS NULL OR parent_id <> id),
  CHECK (
    (blocked = 0 AND blocked_reason IS NULL AND blocked_at IS NULL)
    OR
    (blocked = 1 AND blocked_reason IS NOT NULL AND length(trim(blocked_reason)) > 0 AND blocked_at IS NOT NULL)
  ),
  CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL AND deletion_batch IS NULL)
    OR
    (deleted_at IS NOT NULL AND deletion_batch IS NOT NULL)
  ),
  UNIQUE (project_id, number)
);

CREATE TABLE issue_links (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  url TEXT NOT NULL CHECK (length(url) BETWEEN 1 AND 2048),
  label TEXT CHECK (label IS NULL OR length(label) <= 200),
  created_by TEXT NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
  stored_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (length(mime_type) BETWEEN 1 AND 255),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  text_path TEXT,
  created_by TEXT NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 65536),
  author_id TEXT NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT REFERENCES actors(id) ON DELETE SET NULL
);

CREATE TABLE activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE RESTRICT,
  actor_id TEXT REFERENCES actors(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  type TEXT NOT NULL,
  changes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
```

## Indexes

```sql
CREATE INDEX idx_issues_board
  ON issues(project_id, stage, position) WHERE deleted_at IS NULL;
CREATE INDEX idx_issues_assignee
  ON issues(assignee_id, stage) WHERE deleted_at IS NULL;
CREATE INDEX idx_issues_parent
  ON issues(parent_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_issues_updated ON issues(updated_at);
CREATE INDEX idx_issues_deleted ON issues(deleted_at);
CREATE INDEX idx_issues_blocked ON issues(blocked) WHERE blocked = 1;
CREATE UNIQUE INDEX idx_issues_client_request
  ON issues(project_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX idx_comments_issue
  ON comments(issue_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_links_issue ON issue_links(issue_id);
CREATE INDEX idx_attachments_issue
  ON attachments(issue_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_attachments_issue_sha
  ON attachments(issue_id, sha256) WHERE deleted_at IS NULL;
CREATE INDEX idx_activities_issue ON activities(issue_id, id);
CREATE INDEX idx_activities_project ON activities(project_id, id);
```

## Full-text search

```sql
CREATE VIRTUAL TABLE issues_fts USING fts5(
  title,
  description,
  key,
  content = 'issues',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER issues_fts_ai AFTER INSERT ON issues BEGIN
  INSERT INTO issues_fts(rowid, title, description, key)
  VALUES (new.rowid, new.title, new.description, new.key);
END;

CREATE TRIGGER issues_fts_ad AFTER DELETE ON issues BEGIN
  INSERT INTO issues_fts(issues_fts, rowid, title, description, key)
  VALUES ('delete', old.rowid, old.title, old.description, old.key);
END;

CREATE TRIGGER issues_fts_au AFTER UPDATE OF title, description, key ON issues BEGIN
  INSERT INTO issues_fts(issues_fts, rowid, title, description, key)
  VALUES ('delete', old.rowid, old.title, old.description, old.key);
  INSERT INTO issues_fts(rowid, title, description, key)
  VALUES (new.rowid, new.title, new.description, new.key);
END;
```

Search query:

```sql
SELECT i.*
FROM issues_fts f
JOIN issues i ON i.rowid = f.rowid
WHERE issues_fts MATCH :q
  AND i.deleted_at IS NULL
ORDER BY bm25(issues_fts), i.updated_at DESC
LIMIT :limit;
```

Sanitize the user query before `MATCH`: escape double quotes, reject empty input, and append `*` only to the last term if the user did not provide FTS syntax. A malformed query must return `validation_error`, not a 500.

## Immutability triggers

```sql
CREATE TRIGGER projects_key_immutable
BEFORE UPDATE OF key ON projects
FOR EACH ROW WHEN old.key <> new.key
BEGIN SELECT RAISE(ABORT, 'project key is immutable'); END;

CREATE TRIGGER issues_identity_immutable
BEFORE UPDATE OF project_id, number, key ON issues
FOR EACH ROW
WHEN old.project_id <> new.project_id OR old.number <> new.number OR old.key <> new.key
BEGIN SELECT RAISE(ABORT, 'issue identity is immutable'); END;

CREATE TRIGGER activities_no_update
BEFORE UPDATE ON activities
BEGIN SELECT RAISE(ABORT, 'activities are append-only'); END;

CREATE TRIGGER activities_no_delete
BEFORE DELETE ON activities
BEGIN SELECT RAISE(ABORT, 'activities are append-only'); END;
```

## Key allocation

Inside the create transaction:

```sql
UPDATE projects
SET next_issue_number = next_issue_number + 1,
    updated_at = :now
WHERE id = :project_id
RETURNING next_issue_number - 1 AS number;
```

The returned number becomes `issues.number`; `issues.key = project.key || '-' || number`. Project keys and issue keys are immutable. Deleted Issues keep their numbers.

## Parent cycle check

Before setting `parent_id = :proposed_parent`, reject `proposed_parent = issue_id` and reject a parent that is a descendant:

```sql
WITH RECURSIVE descendants(id) AS (
  SELECT id FROM issues WHERE parent_id = :issue_id
  UNION ALL
  SELECT i.id
  FROM issues i
  JOIN descendants d ON i.parent_id = d.id
)
SELECT 1 AS cycle
FROM descendants
WHERE id = :proposed_parent
LIMIT 1;
```

Also require `proposed_parent.project_id = issue.project_id`.

## Progress query

```sql
SELECT
  COALESCE(SUM(CASE WHEN stage = 'done' THEN 1 ELSE 0 END), 0) AS done,
  COALESCE(SUM(CASE WHEN stage NOT IN ('done', 'cancelled') THEN 1 ELSE 0 END), 0) AS active,
  COALESCE(SUM(CASE WHEN stage = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled
FROM issues
WHERE parent_id = :issue_id
  AND deleted_at IS NULL;
```

Card display: `done/active`. Cancelled children are shown separately and excluded from the denominator. No children means no progress bar.

## Board query

```sql
SELECT id, key, title, stage, priority, assignee_id, module_id,
       blocked, blocked_reason, position, rev, updated_at
FROM issues
WHERE project_id = :project_id
  AND deleted_at IS NULL
  AND stage = :stage
ORDER BY position ASC, id ASC
LIMIT :limit;
```

The API runs this per Stage and enriches with Assignee, Module, counts, and child progress. A column may be capped (default 500) with `has_more`.

## Soft delete and restore

Cascade delete collects the subtree and writes one batch:

```sql
WITH RECURSIVE subtree(id) AS (
  SELECT id FROM issues WHERE id = :root_id AND deleted_at IS NULL
  UNION ALL
  SELECT i.id
  FROM issues i
  JOIN subtree s ON i.parent_id = s.id
  WHERE i.deleted_at IS NULL
)
UPDATE issues
SET deleted_at = :now,
    deleted_by = :actor_id,
    deletion_batch = :batch,
    rev = rev + 1,
    updated_at = :now
WHERE id IN (SELECT id FROM subtree);
```

Restore a batch:

```sql
UPDATE issues
SET deleted_at = NULL,
    deleted_by = NULL,
    deletion_batch = NULL,
    rev = rev + 1,
    updated_at = :now
WHERE deletion_batch = :batch;
```

A child deleted in an earlier batch has a different `deletion_batch` and stays deleted. Restore refuses if the Issue's parent is still deleted in another batch; the UI restores the whole batch.

## Revision scope

`issues.rev` increments for core Issue fields:

- title, description, priority, assignee, module, parent
- stage and position
- blocked / blocked_reason
- delete / restore

Attachments, links, and comments have their own rows and do not bump `issues.rev`. They still write Activity rows and emit SSE events. This prevents a file upload from forcing a description editor to retry.

Comments have their own `rev` for edit conflicts.

## Activity payload

`activities.changes_json` is a JSON array:

```json
[
  { "field": "stage", "from": "todo", "to": "in_progress" },
  { "field": "assignee", "from": null, "to": "frontend-agent" }
]
```

For `issue.created`, include a compact snapshot. For attachments, links, and comments, include the affected ID, name/URL, and a short excerpt. Cap text values at 256 KB; for longer descriptions store the first 256 KB and `truncated: true`.

## Migrations

- `PRAGMA user_version` is the schema version.
- `src/server/db/migrations/001_init.sql` contains the v1 schema.
- The runner applies files in numeric order inside a transaction, then sets `user_version`.
- Before applying a migration to an existing database, take a backup.
- If a migration fails, roll back and refuse to start with a clear log message.
- Never edit an applied migration; add the next numbered file.

## First run

- Create the data directory and database.
- Apply `001_init.sql`.
- No seed Project or Issue.
- The UI setup flow creates the owner Actor (`kind = human`) and optionally the first Project.
- Agents call `identify` to create their own Actor rows.

## Acceptance criteria

- The schema applies cleanly to an empty database with `foreign_keys=ON`.
- Every enum and cross-field constraint in this spec is enforced or explicitly app-level.
- FTS insert/update/delete triggers keep search results correct after title/description changes and soft delete.
- Concurrent key allocation produces no duplicate `(project_id, number)`.
- A parent cycle is rejected before any write.
- Progress excludes cancelled and deleted children.
- A cascade delete and a batch restore round-trip a subtree without reviving earlier deletions.
- Activity rows cannot be updated or deleted.
