# 08 — Security

**Status:** specified
**Depends on:** [00-overview](00-overview.md), [05-http-api](05-http-api.md), [07-attachments](07-attachments.md)
**Feeds:** M2, M3, M6, M7

## Threat model

The deployment is local and single-user. The realistic threats are:

| Threat | Vector | Control | Residual risk |
|---|---|---|---|
| Another web page mutates the tracker | Browser on the same machine requests `127.0.0.1:4319` | CSRF token + `Origin`/`Sec-Fetch-Site` checks; JSON preflight; no CORS | A browser extension or local process can still act as the user |
| DNS rebinding | Attacker domain resolves to `127.0.0.1` | `Host` header allowlist; no CORS; token for MCP | A local proxy could rewrite headers |
| Unauthorized MCP client | Another local process calls `/mcp` | Bearer token generated on first run | Any process that can read the config file or env can use it |
| Prompt-injected agent destroys work | Agent calls delete/update | Soft delete; Activity audit; UI restore; Projects UI-only | An agent can still delete many Issues; recovery is manual |
| Path traversal | Attachment/doc path input | Allowlist, `realpath` containment, server-generated paths | Symlink races in the project root (mitigated by `realpath`) |
| XSS via Markdown | Issue/comment body | `rehype-sanitize`, no raw HTML, safe link rel | A browser 0-day |
| Arbitrary file open | Attachment open endpoint | ID-only lookup; stored path; CSRF; localhost | Any local process can call the endpoint if it obtains CSRF |
| SQL injection | Search/filter input | Prepared statements; FTS query sanitization | None known |
| Secret leakage | Logs, exports, UI | Redact `Authorization`; token never in export/HTML | Backups contain the token if config is backed up; keep config out of exports |
| Disk exhaustion | Uploads/backups | 25 MB per file, per-column caps, retention | No global quota in v1 |
| Backup exposure | Backup folder | User-profile permissions; documented unencrypted | Anyone with the Windows account can read it |

This is not a hostile multi-tenant system. The owner's Windows account is the trust boundary.

## Network binding

- Bind `127.0.0.1`, never `0.0.0.0`.
- Validate `Host` against `127.0.0.1:4319` and `localhost:4319` (plus the configured port).
- No TLS: traffic never leaves the loopback interface.
- No CORS headers. Browser requests are same-origin.
- Reject requests with a foreign `Origin` on mutating routes.
- `GET /healthz` is unauthenticated but returns no secrets.

## Tokens

- On first run, generate a 32-byte random token, base64url encoded.
- Store it in `%APPDATA%\shared-context\config.json` with user-only permissions where possible.
- Allow `SHARED_CONTEXT_TOKEN` to override it (tests, advanced setups).
- `/mcp` requires `Authorization: Bearer <token>`. Compare in constant time.
- The UI does not need the MCP token; it uses the same-origin browser session plus CSRF.
- Settings shows the token masked with a copy button and a `Regenerate` action that requires confirmation and restarts MCP clients.
- Logs and error responses never include the token. `GET /api/config` never returns it.

Reasonix registration:

```toml
[[plugins]]
name = "shared-context"
type = "http"
url = "http://127.0.0.1:4319/mcp"
headers = { Authorization = "Bearer ${SHARED_CONTEXT_TOKEN}" }
```

## CSRF and browser-origin checks

- `GET /api/csrf` returns a random token; it is also set as a non-HttpOnly cookie for convenience.
- Every mutating request (`POST`, `PATCH`, `DELETE`) must send `X-CSRF-Token` matching the server token.
- Check `Origin` when present; reject anything other than the configured localhost origin.
- Check `Sec-Fetch-Site` when present; allow `same-origin` and `none`, reject `cross-site`.
- Require `Content-Type: application/json` for JSON mutations; multipart uploads still require the CSRF header.
- Do not rely on cookies alone. The custom header triggers a preflight that a cross-origin page cannot satisfy without CORS.

## MCP authorization

- Token on every `/mcp` request.
- MCP sessions are process-local. A restart invalidates them; clients re-initialize.
- `identify` is attribution, not authentication. Any token holder can claim any Actor name. This is acceptable for a single-user machine; do not present Actor names as a security boundary.
- If per-agent scoping is needed later, add project-scoped tokens in a new ADR.

## Agent permissions

- Agents can create/update/move/claim/release/block/unblock/delete Issues, add/remove attachments and links, and add comments.
- Agents cannot create/rename/delete Projects.
- Agents cannot restore deleted Issues.
- Agents cannot edit/delete comments.
- Agents cannot purge data.
- All agent actions are attributed in Activity; deletion is soft.
- There is no approval prompt in v1. The human can restore a mistakenly deleted subtree from the UI.

## Input validation

- Zod schemas at every MCP tool and HTTP route.
- Enum validation for Stage, Priority, Actor kind, and attachment mode.
- String length limits: title 500, description 256 KB, comment 64 KB, blocked reason 2,000, URL 2,048, label 200, actor/module names 64.
- URL validation: `http`/`https` only; reject credentials in the URL; reject `javascript:`, `file:`, `data:`.
- FTS query sanitization: escape quotes; reject control characters; return `validation_error` for malformed syntax.
- Pagination limits capped at 500.

## Filesystem safety

- Attachment and doc paths are resolved and checked with `realpath` to stay inside the allowed root.
- Project docs must match the allowlist and the Project root.
- Stored attachment paths are relative and server-generated.
- `open` uses `spawn` with an argument array and `shell: false`; never interpolate a path into a shell string.
- Temp files live under `data/tmp` and are cleaned on startup and after failed uploads.
- Reserved Windows names and control characters are stripped from display filenames.

## Markdown and browser safety

- `react-markdown` + `remark-gfm` + `rehype-sanitize`.
- Raw HTML is not rendered.
- Links get `target="_blank"` and `rel="noopener noreferrer"`.
- External images: allow `https` only; consider blocking them by default in a later hardening pass.
- No `dangerouslySetInnerHTML` for user content.
- CSP header for the UI: `default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'`. Adjust for Vite dev mode.

## SQL

- All queries use prepared statements and bound parameters.
- Dynamic filters are composed from a fixed allowlist of columns/operators; no string concatenation of user input.
- Sort keys are enum-mapped, never passed through.
- FTS `MATCH` input is sanitized as above.

## Logging and redaction

- `pino` structured logs; redact `authorization`, `cookie`, `x-csrf-token`, and token-like fields.
- Log request id, route, status, duration, actor name, and issue key; do not log bodies by default.
- Attachment content and extracted text are never logged.
- 14-day retention.

## Backup and export

- Backups are unencrypted and live under the user profile. Document this in settings.
- The MCP token is in `config.json`, not in the database or export; keep config out of shared backups.
- Exports contain Issue content, comments, and attachment metadata, but not file bytes or the token.

## Acceptance criteria

- A cross-origin `POST` without the CSRF header is rejected.
- A request with a foreign `Host` header is rejected.
- `/mcp` without the bearer token returns 401.
- A Markdown body with `<script>` renders as text, not script.
- `read_project_doc` and attachment serving reject `..` and symlink escapes.
- `open` rejects a path that is not a known Attachment.
- Logs contain no `Authorization` header or token.
- The token is absent from `/api/config`, exports, and HTML.
