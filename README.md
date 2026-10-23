# Shared Context

A local, multi-project issue tracker and context service for coding agents, exposed over MCP.

**Status:** M0 (scaffold), M1 (schema + domain), M2 (HTTP API + SSE), M3 (MCP), M4 (board UI), M5 (editable drawer), and M6 (attachments + command palette) are implemented. M7 (settings, trash, export, backup, startup) is next.

## Start here

- [`plan/README.md`](plan/README.md) — plan index, locked decisions, milestone tracker.
- [`CONTEXT.md`](CONTEXT.md) — domain glossary (the vocabulary source of truth).
- [`docs/adr/`](docs/adr/) — eight decision records.
- [`AGENTS.md`](AGENTS.md) — project memory for coding agents.

## What works now

- One local daemon on `127.0.0.1:4319` with `/healthz`.
- SQLite schema with WAL, FTS5, migrations, and the full repository layer.
- Domain services for Projects, Actors, Modules, Issues, hierarchy/progress, revisions, claims, blocking, soft delete/restore, activity, comments, links, attachments metadata, and allowlisted project docs.
- HTTP JSON API for setup, projects, modules, issues, comments, links, actors, search, board, context, docs, activity, and attachments (multipart upload, content, OS open).
- MCP Streamable HTTP at `/mcp` with bearer auth, stateful sessions, `identify`, and all 23 tools.
- Attachment copy/hash/dedupe, text and PDF extraction, capability-gated image content for MCP, and realpath-contained file serving.
- Kanban board with six columns, collapsible Done/Cancelled, compact cards, child progress, drag-and-drop, URL filters, saved views, and live SSE invalidation.
- Editable Issue drawer: immediate Stage/Priority/Assignee/Module/Parent/Blocked updates, explicit title/description saves, conflict banner with reload/copy-draft, children creation, comments, delete dialog, attachments with thumbnails/upload/open/download/remove, links with add/remove, and activity.
- `Ctrl/Cmd+K` command palette: debounced cross-Project search, recent Issues/Projects, Issue and Project jumps, and actions for new Issue, board, settings, and theme.
- Project sidebar, setup flow, create-issue modal, and a read-only Project settings overview until M7.
- CSRF, host, and origin guards; SSE replay from the Activity cursor; `waitForChange`.
- 57 domain, HTTP, SSE, MCP, and concurrency tests plus 5 docs/plan/schema guards.

Not implemented yet: M7 settings editing, the module manager, doc allowlist, trash/restore UI, backups, export, and startup scripts. `npm run test:ui` is also still unwired (no Playwright suite); browser smoke covers the UI for now.

## Commands

```sh
npm install
npm run dev        # server watch + Vite
npm run typecheck
npm run lint
npm test           # docs guards + Vitest
npm run build      # dist/server + dist/web
npm start          # built daemon
```

The daemon stores data under `%LOCALAPPDATA%\shared-context` by default. Override with `SHARED_CONTEXT_DATA_DIR` for a portable or test install.

## Docs

- [`plan/00-overview.md`](plan/00-overview.md) — architecture and scope.
- [`plan/02-data-model.md`](plan/02-data-model.md) — executable schema.
- [`plan/03-concurrency.md`](plan/03-concurrency.md) — revisions and atomic claims.
- [`plan/10-build-order.md`](plan/10-build-order.md) — M0–M7.

## Repository

https://github.com/zauns/shared-context
