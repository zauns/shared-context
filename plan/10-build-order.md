# 10 — Build Order

**Status:** specified
**Depends on:** all specs
**Feeds:** implementation

## Rules

- Complete milestones in order. M2 does not start until M1 tests pass; M3 does not start until the concurrency suite passes.
- Each milestone ends with its acceptance criteria and a green `npm test`.
- Do not build UI against an unverified API. M2 and M3 are the contract; M4 consumes them.
- Keep the plan tracker and spec statuses updated in the same change as the work.
- If a spec proves wrong, stop and update the spec/ADR before coding around it.

## M0 — Scaffold

**Status:** complete.

**Scope:** repository, toolchain, config, SQLite connection, migration runner, health endpoint, docs/plan/schema guards in CI.

Deliverables:

- `package.json` with the scripts in [01-repository-layout](01-repository-layout.md).
- TypeScript strict configs, Express 5, Vite, Tailwind, Vitest, Playwright config (UI tests can be skipped until M4).
- `src/server/index.ts` starts an HTTP server on `127.0.0.1:4319`.
- `src/server/config.ts` resolves env/config/defaults; creates the data tree.
- `src/server/db/connection.ts` opens `node:sqlite`, sets WAL, foreign keys, busy timeout, and exposes a `withImmediateTransaction` helper.
- `src/server/db/migrate.ts` applies `001_init.sql` and sets `user_version`.
- `/healthz` reports version, uptime, DB open, journal mode.
- `.github/workflows/docs.yml` runs the docs/plan/schema guards; extend to `npm test`.
- `README.md` with setup and status.

Acceptance:

- `npm install`, `npm run typecheck`, `npm run test:docs`, `npm run build`, `npm start` succeed on Windows.
- `/healthz` returns 200 and `journal_mode: "wal"`.
- A second instance fails cleanly on the port.
- The data directory is outside the repo and gitignored.

## M1 — Domain and schema

**Status:** complete.

**Scope:** every table, repository, domain rule, and unit test.

Deliverables:

- `001_init.sql` exactly as [02-data-model](02-data-model.md).
- Repositories for projects, modules, actors, issues, links, attachments, comments, activities.
- Domain services for create/update/move/claim/release/block/unblock/delete/restore.
- UUIDv7 IDs, project key validation, issue key allocation, module slugging.
- Parent cycle detection, same-project parent checks, progress calculation.
- FTS triggers and a search helper with query sanitization.
- Soft delete batches and restore.
- Activity insertion in the same transaction as every mutation.
- Unit tests for every rule and edge case in [11-test-plan](11-test-plan.md).

Acceptance:

- `npm run test:unit` passes.
- A migration on an empty DB creates all tables, indexes, triggers, and FTS.
- Key allocation is unique under 50 sequential creates.
- A parent cycle is rejected; a valid hierarchy returns correct progress.
- FTS finds an Issue after a title/description update and stops finding it after soft delete.
- Activity cannot be updated or deleted at the SQL level.

## M2 — HTTP, SSE, and concurrency

**Status:** complete.

**Scope:** the JSON API, error envelope, CSRF/host middleware, SSE, change bus, integration and concurrency tests.

Deliverables:

- All routes in [05-http-api](05-http-api.md), backed by the domain services.
- Zod validation and the shared error envelope.
- `GET /api/csrf`, host/origin middleware, JSON content-type enforcement.
- SSE hub with `Last-Event-ID` replay and `resync`.
- `wait_for_change` bus used by both MCP and SSE.
- Integration tests through Supertest; concurrency tests through real HTTP.
- `/api/setup`, `/api/config`, `/api/actors` basics.

Acceptance:

- The concurrency suite in [11-test-plan](11-test-plan.md) passes: 20 updates → one winner; 20 claims → one Assignee; idempotent creates → one Issue.
- A stale `PATCH` returns 409 with the current Issue.
- SSE receives events in Activity order and replays after reconnect.
- CSRF and foreign-origin requests are rejected.
- A rollback leaves no Activity row.

## M3 — MCP

**Scope:** Streamable HTTP transport, stateful sessions, all 23 tools, MCP client tests.

Deliverables:

- `/mcp` with bearer-token auth and a session map.
- `identify`, `wait_for_change`, and the full tool surface from [04-mcp-tools](04-mcp-tools.md).
- Zod input schemas; JSON-serializable results; `isError` on failures.
- Tool descriptions with the workflow guidance.
- MCP integration tests using the SDK client over HTTP.
- A `/mcp` diagnostic that lists tool count and session state (no secrets).

Acceptance:

- A real MCP client can initialize, identify, create an Issue, read the board, update with a stale rev, and see the conflict payload.
- 20 concurrent claims through MCP produce one Assignee.
- `wait_for_change` wakes on a commit.
- `read_attachment` returns metadata for a non-vision Actor and an image block for a vision Actor.
- A missing token returns 401; a missing Actor returns `actor_required`.

## M4 — Board UI

**Scope:** app shell, Project switcher, six-column board, cards, drag-and-drop, filters, URL state, SSE invalidation.

Deliverables:

- React app served by the daemon; Vite dev proxy.
- Sidebar, top bar, board columns, collapsible Done/Cancelled.
- Card anatomy from [06-ui](06-ui.md).
- dnd-kit drag/drop with optimistic move and rollback.
- Filter bar with URL state; counts; clear all.
- TanStack Query + SSE invalidation.
- Loading, empty, and error states.

Acceptance:

- The board loads a Project and shows all six columns.
- A drag persists through the API and survives reload.
- A simulated 409 rolls the card back with a toast.
- Filters round-trip through the URL.
- An SSE event from a second client updates the board without reload.
- Keyboard drag works.

## M5 — Issue drawer

**Scope:** detail drawer, metadata editing, description editor, children, comments, activity, conflict UX.

Deliverables:

- Deep-linked drawer route.
- Immediate-save metadata controls; blocked reason popover.
- Markdown render/edit/preview with Save/Cancel and `expected_rev`.
- Children list, progress, add-child.
- Comments composer/list/edit/delete own.
- Activity timeline grouped by day.
- Conflict banner with reload/copy draft; no overwrite.
- Delete dialog with cascade confirmation.

Acceptance:

- Opening `/projects/SHC/issues/SHC-42` opens the board with the drawer.
- A stale description save preserves the draft and shows the banner.
- A blocked Issue keeps its Stage and shows the reason on the card.
- A child's Stage change updates the parent progress without reload.
- Comments and Activity are visually distinct.

## M6 — Attachments, PDFs, vision, palette

**Scope:** upload/open/read, text extraction, capability-gated images, global command palette.

Deliverables:

- Multipart upload, MCP `add_attachment`, SHA-256 dedupe.
- Attachment list/grid, thumbnails, open/download/remove.
- PDF text extraction and sidecar caching.
- `read_attachment` modes with text/image/metadata and caps.
- `can_read_images` editing in settings.
- Command palette with cross-project search and actions.
- Attachment error states.

Acceptance:

- Uploading a PNG/PDF/MD works; `.exe`/SVG are rejected.
- Clicking an attachment opens the Windows default app, including spaces in the filename.
- A PDF with selectable text returns text; a scanned PDF returns metadata.
- A vision Actor receives an image block; a non-vision Actor receives metadata.
- The palette finds an Issue in another Project.

## M7 — Settings, trash, export, backup, startup

**Scope:** project/global settings, module manager, doc allowlist, trash, backup now, export, Task Scheduler scripts, end-to-end verification.

Deliverables:

- Project settings: name, root path, doc allowlist, modules, backup status, export, delete when empty.
- Global settings: theme/density, token copy/regenerate, data paths, version.
- Trash view with batch restore.
- `scripts/install-startup.ps1` and `uninstall-startup.ps1`.
- Backup scheduler, catch-up, retention, restore docs.
- Markdown/JSON export.
- README/AGENTS.md update with real commands.
- End-to-end manual checklist.

Acceptance:

- The Task Scheduler task starts the daemon at logon and `/healthz` passes.
- A manual backup produces a valid snapshot; restoring it produces a working board.
- A deleted subtree restores from Trash in one action.
- Export produces a zip with one file per Issue plus `_board.md`.
- A non-allowlisted doc path is refused.
- `npm test` includes unit, integration, concurrency, MCP, docs/plan, and the UI smoke suite.

## Definition of done

- Every acceptance criterion in every spec is checked.
- `npm run typecheck`, `npm run lint`, `npm test` pass.
- The UI smoke suite passes against the built app.
- The manual Windows attachment/startup checklist passes.
- The plan tracker marks M0–M7 complete.
- `AGENTS.md` has the real commands and the repository URL.

## Deferred

- Import from other trackers.
- OCR for scanned PDFs.
- Per-agent project-scoped tokens.
- Watchers, subscriptions, notifications.
- Hard purge UI.
- Custom workflows, WIP limits, sprints, estimates, time tracking.
- Mobile-first layout.
- Windows service mode (explicitly rejected).
