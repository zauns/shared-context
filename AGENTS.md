# Shared Context

A local, multi-project issue tracker and context service for coding agents, exposed over MCP.

## Project

- Status: M0 and M1 are implemented. M2 (HTTP API, SSE, and concurrency through HTTP) is next.
- Repository (private): https://github.com/zauns/shared-context
- Source of truth: `plan/README.md` (plan index and milestone tracker), `CONTEXT.md` (domain glossary), and `docs/adr/` (decision records).
- Stack: Node 24 + TypeScript, Express 5, `node:sqlite` (WAL + FTS5), React + Vite.
- Entry point: `src/server/index.ts`. One daemon on `127.0.0.1:4319` serving `/mcp`, `/api`, `/api/events`, and the UI.
- Data location: one global SQLite database plus managed attachments and backups under `%LOCALAPPDATA%\shared-context`.

## Commands

- `npm install` — install dependencies.
- `npm run dev` — tsx server watch + Vite dev server.
- `npm run typecheck` — typecheck server and web.
- `npm run lint` — ESLint.
- `npm test` — docs/plan/schema guards + all Vitest tests.
- `npm run test:unit` — unit tests only.
- `npm run test:concurrency` — concurrency invariants only.
- `npm run test:docs` — glossary, ADR, plan-link, and schema guards.
- `npm run build` — compile server and build UI.
- `npm start` — run the built daemon.
- `npm run format` — Prettier.
- `gh run list --repo zauns/shared-context --limit 3` — check CI runs.

## Architecture

Implemented:

- `src/server/config.ts` — env/config resolution, data paths, token generation.
- `src/server/logger.ts` — pino with redaction.
- `src/server/db/connection.ts` — `node:sqlite`, WAL, foreign keys, `BEGIN IMMEDIATE` helper.
- `src/server/db/migrate.ts` + `db/migrations/001_init.sql` — versioned schema.
- `src/server/db/repositories/` — projects, actors, modules, issues, activities, comments, links, attachments.
- `src/server/domain/` — types, errors, validation, IDs, time, projects, project summaries, actors, modules, issues, activity, comments, links, attachments, docs.
- `src/server/http/server.ts` — Express app, `/healthz`, static UI fallback; M2 adds the JSON API and SSE.
- `src/web/` — minimal React/Vite shell; M4 replaces it with the board and drawer.
- `test/helpers/db.ts` — in-memory migrated database and seed.
- `test/unit/`, `test/concurrency/` — domain tests.
- `.github/workflows/ci.yml` — `npm ci`, typecheck, lint, test, build.

Planned next:

- M2: `/api` routes, CSRF/host middleware, SSE, `wait_for_change` bus, HTTP concurrency tests.
- M3: `/mcp` Streamable HTTP, sessions, 23 tools.
- M4–M7: board, drawer, attachments/PDF/vision, settings/backup/startup.

## Conventions

- Use the glossary terms exactly: Issue (not task/ticket), Stage (not status), Assignee (one Actor), Blocked (a flag, never a Stage).
- Stage is exactly `backlog`, `todo`, `in_progress`, `review`, `done`, `cancelled`. Never add `blocked`.
- Mutations require `expected_rev`; `claim_issue` is atomic. Do not add last-write-wins paths.
- Soft-delete Issues. Activity is append-only and written in the same transaction as the mutation.
- Projects are UI-managed. Agents may create Modules explicitly through MCP, but not Projects.
- Attachments are copied into the managed store. Image content is returned only to Actors with `can_read_images`; PDFs get best-effort text extraction, no OCR.
- Comments are discussion; Activity is audit. A comment event may appear in Activity, but a Comment is not an Activity.
- Route handlers must call domain services; no mutation SQL in HTTP/MCP adapters.
- `node:sqlite` is synchronous. Never `await` inside a database transaction.
- `plan/README.md` is the tracker. Update the milestone checkbox and matching spec status in the same change that lands the work.
- A spec is a contract. If the code must deviate, add or supersede an ADR and update the affected spec in the same change.
- Update `CONTEXT.md` when a term changes. Add an ADR only for hard-to-reverse, surprising, trade-off decisions: one paragraph, next number.
- When adding or removing glossary terms, ADRs, or plan specs, update `test/docs.test.mjs` / `test/plan.test.mjs` so the guards stay accurate.
- Run `npm run typecheck`, `npm run lint`, and `npm test` before claiming a milestone. `dist/` is generated and gitignored; live data stays outside the repo.

## Notes

M0/M1 verified on 2026-10-22: 5 docs/plan/schema guards and 20 Vitest tests pass; `npm run build` and `npm run lint` pass.
