# 07 — Attachments, PDFs, and Images

**Status:** specified
**Depends on:** [02-data-model](02-data-model.md), [08-security](08-security.md)
**Feeds:** M6

## Supported files

| Extension | MIME | Max | Read behavior |
|---|---|---|---|
| `png` | `image/png` | 25 MB | Image block for vision Actors; metadata otherwise |
| `jpg`, `jpeg` | `image/jpeg` | 25 MB | Image block for vision Actors; metadata otherwise |
| `gif` | `image/gif` | 25 MB | Image block for vision Actors; metadata otherwise |
| `webp` | `image/webp` | 25 MB | Image block for vision Actors; metadata otherwise |
| `txt` | `text/plain` | 25 MB | Text, capped at 1 MB |
| `md` | `text/markdown` | 25 MB | Text, capped at 1 MB |
| `pdf` | `application/pdf` | 25 MB | Extracted text, capped; no OCR |

Rejected: SVG, HTML, JavaScript, executables, archives, and anything not in the table. Extension and MIME sniff must both agree. A `.txt` that sniffs as binary is rejected.

## Storage layout

```
%LOCALAPPDATA%\shared-context\data\
  shared-context.db
  attachments\
    <attachment-id>\
      <sanitized-name>
      <sanitized-name>.text        # optional PDF text sidecar
```

- `attachment-id` is a UUIDv7; the directory is server-generated.
- `sanitized-name` strips path separators, control characters, and Windows-reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`), collapses whitespace, and caps at 200 characters.
- The original filename is preserved in the database.
- `attachments.stored_path` is relative to the data directory. The server never accepts a path from a request when serving or opening a file.
- Files are retained after soft delete until a deliberate purge; v1 has no purge UI.

## Upload pipeline

### UI (multipart)

1. `POST /api/issues/:key/attachments` with `file` and optional `name`.
2. Enforce 25 MB while streaming; abort early on overflow.
3. Stream to a temp file under `data/tmp/`.
4. Sniff MIME; check extension; reject on mismatch.
5. Compute SHA-256 while streaming.
6. Check for an active Attachment with the same `(issue_id, sha256)`; if found, delete the temp file and return the existing Attachment with `deduplicated: true`.
7. Move the temp file to `attachments/<id>/<sanitized-name>`.
8. Insert the Attachment row and `attachment.added` Activity in one transaction.
9. Extract text for `.txt`, `.md`, and `.pdf`; on failure, log and continue with metadata only.
10. Emit SSE `attachment.added`.
11. Return `Attachment` metadata.

### MCP (`add_attachment`)

Same pipeline, but the source is an absolute path on the local machine. Validate that the path exists, is a regular file, is readable, and is not a directory. The file is copied, not referenced. The `name` argument can override the original filename.

### Create-with-attachments

`create_issue` accepts attachment paths. Copy and validate all files to staging before the Issue transaction. If any copy fails, delete the staged files and create nothing. After the Issue row and Attachment rows commit, move the staged files into their final directories. On startup, clean orphaned staging directories.

## Text extraction

- `.txt`/`.md`: read UTF-8; reject invalid UTF-8; cap at 1 MB; store no sidecar (read from the file).
- PDF: use a maintained PDF.js wrapper (`unpdf`); extract per-page text, join with form feeds, cap at 2 MB. Write the sidecar `<stored-name>.text`. If extraction yields no text or throws, leave `text_path` null.
- No OCR. Scanned PDFs are metadata-only and the UI shows "No extractable text".
- Extraction happens after the file is copied and before the MCP/HTTP response when feasible; long PDFs may complete asynchronously with a `text_status` of `pending` / `ready` / `failed`. The UI can refresh.

## `read_attachment`

MCP tool, also used by the UI preview.

- Resolve the Attachment by ID; reject soft-deleted rows.
- `mode: "metadata"`: return a text summary with name, MIME, size, SHA-256, and extracted-text availability.
- `mode: "text"`: return text for `.txt`, `.md`, and PDFs with a sidecar. Images return `text_unavailable`.
- `mode: "auto"`:
  - Text-like: return `TextContent` (capped at 1 MB, `truncated` flag).
  - Image: if the Actor has `can_read_images` and size <= 5 MB, return an `ImageContent` block plus a short text summary. Otherwise return metadata.
  - PDF: extracted text if available; otherwise metadata.
- Reading is not an Activity event.
- Errors: `not_found`, `unsupported_type`, `text_unavailable`, `attachment_too_large_for_context`.

Images above 5 MB are not returned as content blocks even to vision Actors; they get metadata plus the content URL/path. This protects the model context.

## Opening with the OS

`POST /api/attachments/:id/open`:

1. Require CSRF and same-origin.
2. Resolve the Attachment; reject deleted rows.
3. Resolve the stored path and verify it is inside the data directory with `realpath`.
4. Launch the Windows default handler:

```ts
spawn('cmd.exe', ['/c', 'start', '', absolutePath], {
  windowsHide: true,
  windowsVerbatimArguments: true,
  detached: true,
  stdio: 'ignore',
}).unref();
```

5. Fallback to `explorer.exe` if `cmd` fails.
6. Return `{ ok: true }`.

The path is server-generated and quoted as a single argument; no user input reaches the command. Test with spaces and non-ASCII characters. Links are ordinary `<a>` elements in the UI and open in the default browser; they do not go through this endpoint.

## Deduplication

- Only active Attachments on the same Issue are deduplicated, by SHA-256.
- Re-adding the same bytes returns the existing Attachment; the uploaded temp file is deleted.
- Different Issues may hold identical files; no global blob store in v1.
- Soft-deleting an Attachment allows re-adding the same bytes later.

## Backup

Attachments are immutable once written. The nightly job:

1. Takes a consistent SQLite snapshot.
2. Mirrors new attachment directories into the backup folder without deleting existing files.
3. Records the last successful backup time.

A DB snapshot references only files that existed before it; mirroring after the snapshot may copy extra files, which is safe. A file added during the snapshot is retried on the next run. Restore needs both the DB snapshot and the attachment mirror.

## Security

- No path traversal: IDs and server-generated paths only; `realpath` containment check.
- No SVG/HTML inline rendering; no executable types.
- MIME sniff plus extension allowlist.
- 25 MB request cap; 5 MB image content cap; 1 MB text cap.
- Filename sanitization for Windows.
- `open` is CSRF-protected and localhost-only.
- Orphaned staging files are cleaned on startup; failed uploads are logged without content.
- Attachments may contain sensitive data; backups inherit the user profile's permissions and are not encrypted by the app. Document this.

## Acceptance criteria

- Uploading a PNG, a PDF, and a `.md` file succeeds; an `.exe` and an SVG are rejected.
- A duplicate upload returns the existing Attachment with `deduplicated: true`.
- A PDF with selectable text returns extracted text; a scanned PDF returns metadata and "No extractable text".
- A vision Actor receives an image content block under 5 MB; a non-vision Actor receives metadata.
- Clicking an attachment opens it with the default Windows application, including a filename with spaces.
- `GET /api/attachments/:id/content` cannot serve a path outside the data directory.
- Soft-deleting an Attachment hides it but keeps the file for restore/audit.
- The nightly backup copies a new attachment exactly once and does not delete older files.
