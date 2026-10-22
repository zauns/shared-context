# Shared Context

A local, multi-project issue tracker and context service for coding agents, exposed over MCP.

**Status:** M0 (scaffold), M1 (schema + domain), M2 (HTTP API + SSE), M3 (MCP), and M4 (board UI) are implemented. M5 (editable drawer) is next.

## Start here

- [`plan/README.md`](plan/README.md) — plan index, locked decisions, milestone tracker.
- [`CONTEXT.md`](CONTEXT.md) — domain glossary (the vocabulary source of truth).
- [`docs/adr/`](docs/adr/) — eight decision records.
- [`AGENTS.md`](AGENTS.md) — project memory for coding agents.

## What works now

- One local daemon on `127.0.0.1:4319` with `/healthz`.
- SQLite schema with WAL, FTS5, migrations, and the full repository layer.
- Domain services for Projects, Actors, Modules, Issues, hierarchy/progress, revisions, claims, blocking, soft delete/restore, activity, comments, links, attachments metadata, and allowlisted project docs.
- HTTP JSON API for setup, projects, modules, issues, comments, links, actors, search, board, context, docs, activity, and attachment metadata.
- MCP Streamable HTTP at `/mcp` with bearer auth, stateful sessions, `identify`, and all 23 tools.
- Attachment copy/hash/dedupe, text and PDF extraction, and capability-gated image content for MCP.
- Kanban board with six columns, collapsible Done/Cancelled, compact cards, child progress, drag-and-drop, URL filters, saved views, and live SSE invalidation.
- Project sidebar, setup flow, create-issue modal, and a read-only Issue drawer.
- CSRF, host, and origin guards; SSE replay from the Activity cursor; `waitForChange`.
- 42 domain, HTTP, SSE, MCP, and concurrency tests plus 5 docs/plan/schema guards.

Not implemented yet: editable drawer fields/conflict banner, comments in the drawer, attachment upload/open UI, the command palette, backups, export, and startup scripts.

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
