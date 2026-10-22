# 12 — Risks, Assumptions, and Early Spikes

**Status:** specified
**Depends on:** all specs
**Feeds:** M0, M1, M3, M6

## Risk register

| Risk | Likelihood | Impact | Mitigation | Trigger / fallback |
|---|---|---|---|---|
| `node:sqlite` lacks a needed feature | Low | Medium | It supports WAL, FTS5, `BEGIN IMMEDIATE`, `RETURNING`, and backups (verified) | Swap to `better-sqlite3` behind the repository interface; schema/tests unchanged |
| Reasonix does not preserve `Mcp-Session-Id` | Medium | High for `identify` | Test in M3 with a real client; session map is explicit | Fall back to a required per-call `actor`; keep `identify` for defaults |
| Reasonix cannot surface `ImageContent` | Medium | Medium | Test with a vision model early | `read_attachment` returns the file path plus metadata; the agent uses its own image tool |
| PDF text extraction is poor on Windows | Medium | Medium | Spike `unpdf` on real PDFs in M6 | Metadata-only, documented; no OCR |
| `cmd /c start` quoting breaks on spaces/Unicode | Medium | High for the "open with default app" requirement | Spike in M6 with real filenames; test `explorer.exe` fallback | Fall back to `explorer.exe` for files, `rundll32` for URLs |
| MCP SDK + Express 5 integration friction | Medium | Medium | Use the SDK's Node request/response examples; isolate in `src/server/mcp` | Swap Express for a raw Node handler on `/mcp` |
| SQLite write contention with a long read | Low | Low | Single writer, WAL, synchronous `node:sqlite`; no long transactions | Add indexes, cap board queries, move search off the hot path |
| Large board slows the UI | Medium | Medium | Per-column cap 500, `has_more`, virtualization later | Add column virtualization; server-side pagination |
| Attachment disk growth | Medium | Medium | 25 MB cap, incremental backup, no global dedupe in v1 | Add a purge UI and global content-addressed store later |
| Backup/attachment inconsistency | Low | High | DB snapshot then incremental attachment mirror; verify snapshot integrity | Re-copy attachments; add a manifest/checksum verification |
| Agent deletes or corrupts work | Medium | High | Soft delete, batch restore, append-only Activity, Projects UI-only | Restore from Trash or a nightly backup |
| Token leaks in logs or exports | Low | High | Redaction, no token in `/api/config`/export/HTML, review logs | Rotate token; update Reasonix config |
| Prompt injection via Issue text | Medium | Medium | Markdown is sanitized; tool descriptions treat content as data; no server-side instruction execution | The human reviews; no autonomous destructive tools beyond the defined surface |
| Windows path length/Unicode issues | Low | Medium | Use UUID directories, sanitize names, test real paths | Shorten stored names; use `\\?\` long paths if needed |
| FTS query syntax errors | Medium | Low | Sanitize input; return `validation_error` | Quote terms; disable advanced syntax |
| Dependency churn (`unpdf`, MCP SDK, React) | Medium | Medium | Pin versions, small adapters, no deep coupling | Replace behind the adapter |
| No import path from another tracker | Low | Low | Explicit non-goal; export only | Add a one-off importer later |
| Single-user assumption breaks | Low | High | Documented non-goal; no auth model | New ADR for multi-user/remote access |

## Early spikes

Do these before the dependent milestone, not after:

### Spike 1 — `node:sqlite` (before M1)

- Open a file DB, set WAL, foreign keys, busy timeout.
- Create a table, FTS5 virtual table, triggers.
- `BEGIN IMMEDIATE`, `UPDATE ... RETURNING`, `VACUUM INTO` or `.backup`.
- Confirm no experimental warning or native build.
- Confirm `PRAGMA integrity_check` on a backup.

Fallback: `better-sqlite3` behind `db/connection.ts` and repositories.

### Spike 2 — Reasonix MCP session and image content (before M3)

- Register a throwaway `/mcp` server in Reasonix with a bearer token.
- Confirm the client keeps `Mcp-Session-Id` across calls.
- Confirm `identify` state survives several tool calls.
- Confirm a vision session receives an `ImageContent` block and a non-vision session does not.
- Confirm `wait_for_change` with a 60s timeout is not killed by the host's call timeout.

Fallback: per-call `actor` and attachment path/metadata instead of image blocks.

### Spike 3 — PDF text extraction (before M6)

- Extract text from a text PDF and a scanned PDF with `unpdf`.
- Measure memory/time on a 25 MB PDF.
- Confirm the sidecar path and failure behavior on Windows.
- Decide whether extraction is synchronous or background.

Fallback: metadata-only PDFs; no OCR.

### Spike 4 — Windows open-with-default (before M6)

- Attach a file with spaces and non-ASCII characters.
- Launch with `cmd.exe /c start "" "<path>"` and `windowsVerbatimArguments`.
- Confirm it works from a Task Scheduler logon process, not just a terminal.
- Test the `explorer.exe` fallback.

Fallback: `explorer.exe` for files, `rundll32 url.dll,FileProtocolHandler` for links.

## Assumptions

- The machine is single-user; the Windows account is the trust boundary.
- The daemon runs while the user is logged in; it is not a service.
- Personal scale: a few Projects, hundreds to low thousands of Issues, tens of attachments per Issue.
- Reasonix and other MCP clients can use Streamable HTTP and send custom headers.
- A local SQLite database is acceptable; no cloud sync.
- The user can run `npm` and Node 24 on Windows.
- The user accepts no import, no OCR, no multi-user auth, and no notifications in v1.

## Decision triggers

Revisit an ADR if any of these happen:

- More than one human needs access → multi-user auth and remote access.
- More than ~10k active Issues or slow boards → pagination/virtualization or a different store.
- Agents need project-scoped permissions → token scopes and an authorization model.
- Attachments exceed ~10 GB → global dedupe and a purge policy.
- The daemon must run without a logged-in user → a service plus a separate file-opening helper.
- MCP cannot preserve sessions → per-call actor becomes mandatory.

## Acceptance criteria

- Every high-impact risk has a mitigation and a fallback.
- Each spike has a concrete pass/fail check before its milestone.
- The assumptions match the non-goals in [00-overview](00-overview.md).
- A future agent can see which unknowns are already verified and which are still assumptions.
