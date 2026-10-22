# 05 — HTTP API

**Status:** implemented (M2); attachment/admin routes are stubs until M6/M7
**Depends on:** [02-data-model](02-data-model.md), [03-concurrency](03-concurrency.md), [04-mcp-tools](04-mcp-tools.md), [07-attachments](07-attachments.md)
**Feeds:** M2

## Conventions

- Base path: `/api`. MCP is `/mcp`; health is `/healthz`.
- JSON request and response bodies, except multipart uploads and file content.
- Dates are ISO 8601 UTC strings with `Z`.
- Issue path parameters accept a key (`SHC-42`) or UUID; project parameters accept a key or UUID.
- Mutating requests require `X-CSRF-Token` and a same-origin `Origin`/`Sec-Fetch-Site`.
- No CORS headers. The UI is same-origin.
- Errors use the same envelope as MCP:

```json
{
  "ok": false,
  "error": { "code": "conflict", "message": "Issue changed since revision 12", "details": {} },
  "issue": { "...current state when relevant..." }
}
```

- Status codes: `200`, `201`, `204`, `400` validation, `401` bad MCP token, `403` CSRF/origin, `404`, `409` conflict, `413` too large, `415` unsupported type, `422` parent cycle, `500` internal.
- Pagination: `limit` (1–500) and opaque `cursor`; responses include `next_cursor`.
- Lists use `{ ok, items, next_cursor, total? }`.

## CSRF

`GET /api/csrf` returns `{ token }`. The token is random per process start and is also accepted from the `sc_csrf` cookie. The UI fetches it once and sends `X-CSRF-Token` on every mutating request. The server checks the header and rejects cross-origin `Origin` values. This blocks a random local web page from mutating the tracker through the browser; it is not a defense against a local process.

## Projects

| Method | Path | Body / query | Returns |
|---|---|---|---|
| `GET` | `/api/projects` | — | `ProjectSummary[]` |
| `POST` | `/api/projects` | `{ key, name, description?, root_path?, doc_allowlist? }` | `ProjectSummary` (201) |
| `GET` | `/api/projects/:idOrKey` | — | Project detail with counts |
| `PATCH` | `/api/projects/:idOrKey` | `{ name?, description?, root_path?, doc_allowlist? }` | `ProjectSummary` |
| `DELETE` | `/api/projects/:idOrKey` | — | `{ ok: true }`; 409 if any Issues exist |
| `GET` | `/api/projects/:key/board` | filters | Board read model |
| `GET` | `/api/projects/:key/context` | — | Context Snapshot |
| `GET` | `/api/projects/:key/docs` | `?path=` | `{ path, content, truncated, size }` |

Project key is immutable after creation. Deleting a Project is allowed only when it has zero Issues, including soft-deleted ones. This is deliberately stricter than cascading a data loss.

## Modules

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/projects/:key/modules` | — | `Module[]` |
| `POST` | `/api/projects/:key/modules` | `{ name, color? }` | `Module` (201) |
| `PATCH` | `/api/modules/:id` | `{ name?, color? }` | `Module` |
| `DELETE` | `/api/modules/:id` | — | `{ ok: true }`; 409 if in use |

Deleting an unused Module is allowed. Renaming changes the display name, not the slug.

## Issues

| Method | Path | Body / query | Returns |
|---|---|---|---|
| `GET` | `/api/issues` | `project`, `q`, `stages`, `priorities`, `assignee`, `module`, `parent`, `blocked`, `has_attachments`, `updated_since`, `include_deleted`, `limit`, `cursor`, `view`, `sort` | `{ items, next_cursor }` |
| `POST` | `/api/issues` | `{ project, title, description?, stage?, priority?, assignee?, module?, parent?, links?, client_request_id? }` | `IssueDetail` (201) |
| `GET` | `/api/issues/:key` | `activity_limit?`, `comment_limit?` | `IssueDetail` |
| `PATCH` | `/api/issues/:key` | `{ expected_rev, title?, description?, priority?, assignee?, module?, parent? }` | `IssueDetail` |
| `DELETE` | `/api/issues/:key` | `?cascade=true&reason=` | `{ deleted, batch }` |
| `POST` | `/api/issues/:key/move` | `{ expected_rev, stage, position? }` | `IssueDetail` |
| `POST` | `/api/issues/:key/claim` | `{ expected_rev? }` | `{ claimed, issue }` |
| `POST` | `/api/issues/:key/release` | `{ expected_rev? }` | `{ released, issue }` |
| `POST` | `/api/issues/:key/block` | `{ expected_rev, reason }` | `IssueDetail` |
| `POST` | `/api/issues/:key/unblock` | `{ expected_rev }` | `IssueDetail` |
| `POST` | `/api/issues/:key/restore` | — | `{ restored, batch }` |

`POST /api/issues` does not accept attachments; the UI creates the Issue, then uploads attachments. `PATCH` cannot change Stage or blocked; those are explicit routes. The UI sends `expected_rev` on every core-field mutation.

## Links

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/issues/:key/links` | `{ url, label? }` | `Link` (201) |
| `DELETE` | `/api/links/:id` | — | `{ ok: true }` |

Only `http` and `https` URLs. Max 50 active links per Issue.

## Attachments

| Method | Path | Body / query | Returns |
|---|---|---|---|
| `POST` | `/api/issues/:key/attachments` | multipart `file`, optional `name` | `Attachment` (201) |
| `GET` | `/api/attachments/:id` | — | `Attachment` metadata |
| `GET` | `/api/attachments/:id/content` | `?download=1` | File stream |
| `POST` | `/api/attachments/:id/open` | — | `{ ok: true }` after OS launch |
| `DELETE` | `/api/attachments/:id` | — | `{ ok: true }` (soft delete) |

`content` serves images and PDFs inline; other types get `Content-Disposition: attachment`. The server resolves the path from the database, never from the request. `open` requires CSRF and same-origin; it launches the Windows default handler in the user's session.

## Comments

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/issues/:key/comments` | `limit`, `before` | `Comment[]` |
| `POST` | `/api/issues/:key/comments` | `{ body }` | `Comment` (201) |
| `PATCH` | `/api/comments/:id` | `{ body, expected_rev }` | `Comment` |
| `DELETE` | `/api/comments/:id` | — | `{ ok: true }` (soft delete) |

Only the author may edit/delete a comment; the owner Actor (`kind = human`) may moderate any comment. Comment edits bump the comment `rev`, not the Issue `rev`. Each action writes Activity.

## Actors

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/actors` | — | `ActorRef[]` |
| `POST` | `/api/actors` | `{ name, kind, can_read_images?, color? }` | `ActorRef` (201) |
| `PATCH` | `/api/actors/:id` | `{ name?, can_read_images?, color? }` | `ActorRef` |

The setup flow creates the human owner Actor. Agents are normally created by `identify`; the UI list is for assignment and capability editing.

## Search

`GET /api/search?q=&limit=` returns compact results across all Projects:

```json
{
  "ok": true,
  "items": [
    { "project": { "key": "SHC", "name": "Shared Context" }, "issue": { "...IssueCard..." } }
  ]
}
```

Order by FTS relevance, then updated. Empty `q` returns `validation_error`.

## Events (SSE)

`GET /api/events?since=<activity_id>&project=<key>`:

```text
id: 123
event: issue.updated
data: {"id":123,"type":"issue.updated","project_id":"...","issue_id":"...","issue_key":"SHC-42","rev":14,"actor":{"id":"...","name":"frontend-agent"},"at":"...","changes":[...]}

: ping
```

- `Last-Event-ID` is honored; `since` is the fallback.
- Replay is capped at 1,000 events. If the gap is larger, emit `event: resync` with `{ cursor }` and let the UI refetch.
- Heartbeat every 15 seconds.
- Same-origin only; no CORS.
- On disconnect, the client reconnects with the last id.

## Admin and setup

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | Version, uptime, DB open/WAL status |
| `GET` | `/api/config` | Version, port, data paths, backup status; never the token |
| `GET` | `/api/setup` | `{ required: boolean }` |
| `POST` | `/api/setup` | Create owner Actor and optional first Project |
| `POST` | `/api/admin/backup` | Run a backup now |
| `GET` | `/api/admin/backups` | List snapshots with date and size |
| `GET` | `/api/admin/export` | `?project=&format=md|json` download |

Admin mutations require CSRF and same-origin. Export and backup may take seconds; return JSON with a status and let the UI poll the list, or stream the download directly.

## SPA fallback

`GET /` and unknown non-API paths serve `dist/web/index.html`. Exclude `/api/*`, `/mcp`, `/healthz`, and `/api/events`. In development, Vite serves the UI and proxies the API.

## Acceptance criteria

- Every UI action has one route and reuses the same domain service as MCP.
- Mutating routes reject a missing/incorrect CSRF token and cross-origin requests.
- `PATCH /api/issues/:key` with a stale rev returns 409 and the current Issue.
- SSE replays from `Last-Event-ID` and emits `resync` when the gap is too large.
- Uploads are size/type-limited and served from server-resolved paths.
- `/healthz` is reachable without CSRF and reports DB status.
- No token appears in any response body.
