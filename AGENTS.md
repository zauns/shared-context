# Shared Context

A local, multi-project issue tracker and context service for coding agents, exposed over MCP.

## Project

- Status: specified. There is no application code, `package.json`, or build tooling yet.
- Repository (private): https://github.com/zauns/shared-context
- Source of truth: `plan/README.md` (plan index and milestone tracker), `CONTEXT.md` (domain glossary), and `docs/adr/` (decision records).
- Planned stack: Node 24 + TypeScript, Express 5, `node:sqlite` (WAL + FTS5), React + Vite.
- Planned entry point: `src/server/index.ts`. One daemon on `127.0.0.1:4319` serving `/mcp`, `/api`, `/api/events`, and the UI.
- Planned data location: one global SQLite database plus managed attachments and backups under `%LOCALAPPDATA%\shared-context`.

## Commands

- `node --test test/docs.test.mjs test/plan.test.mjs test/schema.test.mjs` — validate the glossary, ADRs, plan index/spec links, and the v1 schema.
- `gh run list --repo zauns/shared-context --limit 3` — check the docs/plan/schema CI runs.
- No `npm test`, build, run, or lint commands exist yet. Do not assume a manifest.

## Architecture

Current, documentation-only:

- `plan/README.md` — plan index, locked decisions, milestone tracker.
- `plan/00-overview.md` … `plan/12-risks.md` — one spec per subsystem; these are implementation contracts.
- `CONTEXT.md` — domain glossary; no implementation details.
- `docs/adr/` — one-paragraph decision records, numbered sequentially.
- `test/docs.test.mjs` — guard that the glossary terms and ADR count exist.
- `test/plan.test.mjs` — guard that every spec is linked and every ADR link resolves.
- `test/schema.test.mjs` — execute the v1 schema from `plan/02-data-model.md` in memory and check its constraints.
- `.github/workflows/docs.yml` — run the same guards on push and pull request (Node 24).

Planned (details in `plan/01-repository-layout.md`):

- `src/server/db` — schema, migrations, repositories; SQLite is the only writer.
- `src/server/domain` — projects, issues, modules, actors, comments, activity; all mutations transactional.
- `src/server/http` — JSON API, SSE, security middleware.
- `src/server/mcp` — Streamable HTTP MCP server, session identity, tool definitions.
- `src/server/services` — attachments, PDF text extraction, OS file opening, backups.
- `src/web` — React kanban, issue drawer, filters, command palette.

## Conventions

- Use the glossary terms exactly: Issue (not task/ticket), Stage (not status), Assignee (one Actor), Blocked (a flag, never a Stage).
- Stage is exactly `backlog`, `todo`, `in_progress`, `review`, `done`, `cancelled`. Never add `blocked`.
- Mutations require `expected_rev`; `claim_issue` is atomic. Do not add last-write-wins paths.
- Soft-delete Issues. Activity is append-only and written in the same transaction as the mutation.
- Projects are UI-managed. Agents may create Modules explicitly through MCP, but not Projects.
- Attachments are copied into the managed store. Image content is returned only to Actors with `can_read_images`; PDFs get best-effort text extraction, no OCR.
- Comments are discussion; Activity is audit. A comment event may appear in Activity, but a Comment is not an Activity.
- `plan/README.md` is the tracker. Update the milestone checkbox and the matching spec status in the same change that lands the work.
- A spec is a contract. If the code must deviate, add or supersede an ADR and update the affected spec in the same change.
- Update `CONTEXT.md` when a term changes. Add an ADR only for hard-to-reverse, surprising, trade-off decisions: one paragraph, next number.
- When adding or removing glossary terms, ADRs, or plan specs, update `test/docs.test.mjs` / `test/plan.test.mjs` so the guards stay accurate.
- No application code yet: do not invent files or commands. Update this file when the scaffold lands.

## Notes
