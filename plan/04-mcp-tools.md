# 04 — MCP Tool Contracts

**Status:** specified
**Depends on:** [02-data-model](02-data-model.md), [03-concurrency](03-concurrency.md), [07-attachments](07-attachments.md)
**Feeds:** M3

## Transport and sessions

- Endpoint: `/mcp` on `127.0.0.1:4319`.
- Transport: MCP Streamable HTTP (`@modelcontextprotocol/sdk`).
- Stateful sessions: the server maps `Mcp-Session-Id` to `{ server, transport, actorId?, defaultProjectId? }`.
- Every request requires `Authorization: Bearer <token>`. Missing or invalid: HTTP 401 with `unauthorized`.
- On `initialize`, create a session. On `DELETE`, close it. Expire idle sessions after 24 hours.
- If a session is missing or expired, return 404/400; the client re-initializes and calls `identify` again.
- The MCP server is one logical server; all Reasonix sessions share the same tools and data.

## Common shapes

### ActorRef

```ts
{ id: string; name: string; kind: 'human' | 'agent'; can_read_images: boolean; color: string | null }
```

### Module

```ts
{ id: string; name: string; slug: string; color: string | null }
```

### ProjectSummary

```ts
{
  id: string; key: string; name: string; description: string;
  root_path: string | null; modules: Module[];
  counts: {
    by_stage: Record<Stage, number>;
    by_priority: Record<Priority, number>;
    blocked: number; total: number;
  };
  updated_at: string;
}
```

### IssueCard

```ts
{
  id: string; key: string; title: string;
  stage: Stage; priority: Priority;
  assignee: ActorRef | null; module: Module | null;
  blocked: boolean; blocked_reason: string | null;
  attachment_count: number; comment_count: number;
  child_progress: { done: number; active: number; cancelled: number; total: number };
  position: number; rev: number; updated_at: string;
}
```

### IssueDetail

`IssueCard` plus:

```ts
{
  project: { id: string; key: string; name: string };
  number: number; description: string;
  parent: { id: string; key: string; title: string } | null;
  children: IssueCard[];
  links: Link[];
  attachments: Attachment[];
  comments: Comment[];
  activity: ActivityEvent[];
  created_by: ActorRef; created_at: string;
  completed_at: string | null; cancelled_at: string | null;
  latest_activity_id: number;
}
```

### Attachment

```ts
{
  id: string; original_name: string; mime_type: string;
  size_bytes: number; sha256: string;
  created_by: ActorRef; created_at: string;
  has_text: boolean; is_image: boolean;
}
```

### Link

```ts
{ id: string; url: string; label: string | null; created_by: ActorRef; created_at: string }
```

### Comment

```ts
{
  id: string; body: string; author: ActorRef; rev: number;
  created_at: string; updated_at: string;
}
```

### ActivityEvent

```ts
{
  id: number; type: string; project_id: string;
  issue_id: string; issue_key: string;
  actor: ActorRef | null; actor_name: string;
  at: string; changes: Array<{ field: string; from?: unknown; to?: unknown }>;
}
```

## Envelope and errors

Success:

```json
{ "ok": true, "activity_id": 123, "issue": { "...affected entity..." } }
```

Lists:

```json
{ "ok": true, "items": [], "next_cursor": null, "total": 0 }
```

Error:

```json
{
  "ok": false,
  "error": { "code": "conflict", "message": "Issue changed since revision 12", "details": {} },
  "issue": { "...current state when relevant..." }
}
```

MCP errors set `isError: true` and include the JSON as text content. The `ok` field stays so an agent can parse consistently.

## Actor and project resolution

- `identify` binds an Actor to the MCP session.
- Every mutating tool accepts an optional `actor` override for subagents sharing a connection.
- If neither exists, mutating tools return `actor_required`.
- `project` defaults to the session's `default_project`. If neither exists, project-scoped tools return `project_required`.
- Issue references accept a key (`SHC-42`) or UUID; keys are globally unique.
- `asset`-style optional arguments are omitted rather than sent as `null` unless the field is explicitly nullable.

## Tools

### `identify`

Args:

- `actor: string` — 1–64 chars, case-insensitive lookup by `name_key`.
- `default_project?: string` — project key or id; must exist.
- `can_read_images?: boolean` — if provided, update the Actor capability.
- `kind?: 'agent' | 'human'` — defaults to `agent`; only used when creating a new Actor.

Returns `{ ok, actor, default_project }`. Updates `last_seen_at`. Creates the Actor if missing (`name_key` = lowercased name). If the name matches an existing Actor, binds to it and optionally updates the capability. Does not change `kind` of an existing Actor.

### `wait_for_change`

Args:

- `since_activity_id: number` — required, >= 0.
- `project?: string` — filter; defaults to session Project, otherwise all Projects.
- `timeout_seconds?: number` — 1–60, default 60.

Returns `{ ok, cursor, events, timed_out }`. Returns immediately if events after the cursor exist. On timeout, `events: []`, `timed_out: true`, `cursor` = current max. `cursor_invalid` if `since` > max. Never polls.

### `list_projects`

No args. Returns `{ ok, items: ProjectSummary[] }`. Includes deleted Issue counts? No: counts exclude `deleted_at IS NOT NULL`. Projects cannot be deleted while they contain Issues.

### `get_project_context`

Args: `project?: string`.

Returns a Context Snapshot:

```json
{
  "ok": true,
  "project": { "...ProjectSummary..." },
  "counts": { "by_stage": {}, "by_priority": {}, "blocked": 0, "total": 0 },
  "modules": [],
  "blocked_issues": [],
  "my_issues": [],
  "recent_changes": [],
  "docs": [{ "path": "CONTEXT.md", "size": 1234 }]
}
```

`my_issues` uses the session Actor and only active Stages. `recent_changes` is the last 20 Activity events. `docs` is a table of contents; content is fetched with `read_project_doc`. If no root path, `docs` is empty.

### `read_project_doc`

Args: `path: string`, `project?: string`.

Reads a file under the Project root if it matches the Project's `doc_allowlist_json`. Returns `{ ok, path, content, truncated, size }`. Max 256 KB; truncate and set `truncated: true`. Reject absolute paths, `..`, symlinks escaping the root, and non-allowlisted paths. Errors: `doc_not_allowed`, `not_found`, `doc_unavailable` (no root path).

### `create_module`

Args: `name: string` (1–64), `project?: string`, `color?: string`.

Slugifies the name (lowercase ASCII, hyphens). If the slug exists, returns the existing Module with `created: false`. Otherwise inserts and returns `created: true`. Modules are the only taxonomy agents may create.

### `create_issue`

Args:

- `title: string` — required, 1–500.
- `description?: string` — Markdown, max 256 KB.
- `stage?: Stage` — default `backlog`.
- `priority?: Priority` — default `none`.
- `assignee?: string` — Actor name or id; optional.
- `module?: string` — Module slug or name; must exist.
- `parent?: string` — Issue key or id; same Project.
- `links?: Array<{ url: string; label?: string }>` — max 20.
- `attachments?: Array<string | { path: string; name?: string }>` — max 20; absolute local paths.
- `client_request_id?: string` — idempotency key.
- `project?: string` — defaults to session Project.
- `actor?: string` — override.

Returns `IssueDetail` with `created: true/false`. Allocates the next Issue number in the transaction. Appends position to the Stage. Validates links, parent, module, assignee. Copies attachments before the transaction; on any copy failure, no Issue is created. Duplicate `client_request_id` returns the existing Issue with `created: false`.

### `get_issue`

Args: `issue: string`, `activity_limit?: number` (0–200, default 50), `comment_limit?: number` (0–200, default 50).

Returns `IssueDetail`. Includes active children, active attachments, links, comments, activity, progress, counts, `latest_activity_id`. Soft-deleted Issues return `not_found`. Activity is newest first; comments are oldest first.

### `list_issues`

Args:

- `project?: string`
- `q?: string` — FTS over title, description, key.
- `stages?: Stage[]`
- `priorities?: Priority[]`
- `assignee?: string` — name or id.
- `module?: string` — slug or name.
- `parent?: string` — issue key/id.
- `blocked?: boolean`
- `has_attachments?: boolean`
- `updated_since?: string` — ISO timestamp.
- `include_deleted?: boolean` — default false.
- `limit?: number` — 1–500, default 100.
- `cursor?: string`
- `view?: 'compact' | 'full'` — default compact.
- `sort?: 'updated' | 'priority' | 'position'` — default `updated`.

Returns `{ ok, items, next_cursor, total? }`. Compact items are `IssueCard`; full items are `IssueDetail` without activity/comments unless requested. Cursor is opaque base64 containing the sort key and id. AND across filter types, OR within a multi-select. `q` uses FTS and orders by relevance, then updated.

### `get_board`

Args: same filters as `list_issues` except `stages` and pagination. `include_closed?: boolean` default true.

Returns:

```json
{
  "ok": true,
  "project": { "...ProjectSummary..." },
  "columns": [
    { "stage": "backlog", "count": 12, "has_more": false, "issues": [] }
  ],
  "filtered_count": 42
}
```

One column per Stage, in the fixed order. Cards ordered by `position`, then id. Per-column limit 500 with `has_more`. Counts respect filters. The UI can collapse Done/Cancelled, but the API returns them by default.

### `update_issue`

Args: `issue`, `expected_rev`, optional `title`, `description`, `priority`, `assignee` (name/id or null), `module` (slug/name or null), `parent` (issue ref or null), `actor?`.

Cannot change Stage or blocked; use the dedicated tools. Validates title/description lengths, priority, Actor, Module, parent (same Project, no cycle). No-op if nothing changed. Bumps rev and writes `issue.updated` with a `changes` array. Returns `IssueDetail`.

### `move_issue`

Args: `issue`, `expected_rev`, `stage`, `position?`, `actor?`.

Validates Stage. Appends if no position. Sets/clears `completed_at`/`cancelled_at` as defined in [03-concurrency](03-concurrency.md). Does not change blocked. Writes `issue.moved`. Returns `IssueDetail`.

### `claim_issue`

Args: `issue`, `expected_rev?`, `actor?`.

Atomic claim as defined in [03-concurrency](03-concurrency.md). Returns `{ ok, claimed, issue, activity_id? }`. If already owned by the caller, `claimed: false`, `already_owned: true`, no Activity. If another Actor owns it, `claim_conflict` with the current Issue. Done/cancelled: `invalid_state`.

### `release_issue`

Args: `issue`, `actor?`.

Only the current Assignee or a human Actor. Returns `{ ok, released, issue, activity_id? }`. Unassigned is a no-op with `released: false`. Stage unchanged.

### `block_issue`

Args: `issue`, `expected_rev`, `reason` (1–2000), `actor?`.

Sets the blocked flag and reason; Stage unchanged. Same reason is a no-op. Different reason updates and writes Activity. Returns `IssueDetail`.

### `unblock_issue`

Args: `issue`, `expected_rev`, `actor?`.

Clears the flag and reason. Already unblocked is a no-op. Returns `IssueDetail`.

### `delete_issue`

Args: `issue`, `expected_rev`, `cascade?: boolean` (default false), `reason?: string`, `actor?`.

Soft delete. If children exist and `cascade` is false: `has_children` with the count. Cascade soft-deletes the subtree in one batch, one Activity per Issue. Returns `{ ok, deleted: IssueRef[], batch, activity_id }`. Does not delete attachments/comments. Restore is UI-only.

### `add_attachment`

Args: `issue`, `path` (absolute local path), `name?`, `actor?`.

Validates size/type, copies into the managed store, computes SHA-256, dedupes by `(issue_id, sha256)` among active attachments, extracts text for text/Markdown/PDF, inserts metadata and `attachment.added` Activity in a transaction. Does not bump `issues.rev`. Returns `Attachment` with `deduplicated: boolean`.

### `remove_attachment`

Args: `issue`, `attachment_id`, `actor?`.

Verifies the Attachment belongs to the Issue and is active. Sets `deleted_at`, writes `attachment.removed`, emits SSE. Keeps the file. Does not bump `issues.rev`. Returns `{ ok, attachment_id, activity_id }`.

### `read_attachment`

Args: `attachment_id`, `mode?: 'auto' | 'text' | 'metadata'`, `actor?`.

- `metadata`: text summary only.
- `text`: text for `.txt`, `.md`, and PDFs with extracted text; `text_unavailable` for images/other.
- `auto`: text for text-like files; image content block for images if the Actor has `can_read_images` and the file is <= 5 MB; otherwise metadata.

Returns MCP content blocks: a text summary, plus `TextContent` or `ImageContent`. Text is capped at 1 MB with `truncated`. Reading is not an Activity.

### `add_link`

Args: `issue`, `url` (http/https, max 2048), `label?` (max 200), `actor?`.

Max 50 active links per Issue. Inserts and writes `link.added`. Does not bump `issues.rev`. Returns `Link` plus `activity_id`.

### `remove_link`

Args: `issue`, `link_id`, `actor?`.

Verifies ownership, hard-deletes the row, writes `link.removed` with the URL snapshot. Does not bump `issues.rev`. Returns `{ ok, activity_id }`.

### `add_comment`

Args: `issue`, `body` (Markdown, 1–64 KB), `actor?`.

Inserts a Comment, writes `comment.added` with a short excerpt, emits SSE. Does not bump `issues.rev`. Returns `Comment` plus `activity_id`. Comment edit/delete is UI-only.

## UI-only operations

- Project create, rename, delete.
- Module rename and delete.
- Comment edit and delete.
- Restore soft-deleted Issues.
- Attachment open/download in the OS/browser.
- Backup and export.

## Tool descriptions

Every tool description must state:

1. What it does and when to use it.
2. Its side effects (Activity, SSE, rev bump).
3. That mutations require the latest `expected_rev`.
4. That a `conflict` means re-read `get_issue` and retry, not blindly resend.
5. The recommended workflow:

```text
identify
  -> get_project_context
  -> list_issues / get_issue
  -> claim_issue before starting work
  -> update_issue with expected_rev
  -> on conflict: get_issue, then retry
  -> add_comment for handoff/blocker context
  -> move_issue when done
```

## Acceptance criteria

- All 23 tools are registered with Zod input schemas and JSON-serializable results.
- `identify` binds a session; a mutation without an Actor returns `actor_required`.
- A stale `update_issue` returns `conflict` plus the current Issue.
- `claim_issue` races resolve to one owner.
- `wait_for_change` returns persisted events or waits on the bus.
- `read_attachment` returns metadata for a non-vision Actor and an image block for a vision Actor.
- `create_issue` with a duplicate `client_request_id` returns the existing Issue.
- UI-only operations are absent from the MCP surface.
