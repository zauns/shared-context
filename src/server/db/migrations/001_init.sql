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
