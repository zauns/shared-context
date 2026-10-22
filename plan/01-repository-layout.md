# 01 — Repository Layout and Toolchain

**Status:** specified
**Depends on:** [00-overview](00-overview.md)
**Feeds:** M0

## Final tree

```
shared-context/
  AGENTS.md
  CONTEXT.md
  README.md
  package.json
  tsconfig.json
  tsconfig.server.json
  vite.config.ts
  eslint.config.js
  .prettierrc
  .gitignore
  .github/
    workflows/
      docs.yml
  docs/
    adr/
      0001-single-local-daemon.md
      ...
  plan/
    README.md
    00-overview.md
    ...
  src/
    server/
      index.ts                 # process entry point
      config.ts                # config + env resolution
      logger.ts
      db/
        connection.ts          # node:sqlite, pragmas, close
        migrations/
          001_init.sql
        migrate.ts
        repositories/
          projects.ts
          modules.ts
          actors.ts
          issues.ts
          links.ts
          attachments.ts
          comments.ts
          activities.ts
      domain/
        projects.ts
        modules.ts
        actors.ts
        issues.ts
        links.ts
        attachments.ts
        comments.ts
        activity.ts
        errors.ts
        validation.ts
      http/
        server.ts
        routes/
          projects.ts
          modules.ts
          issues.ts
          links.ts
          attachments.ts
          comments.ts
          actors.ts
          search.ts
          admin.ts
          setup.ts
        middleware/
          csrf.ts
          host.ts
          errors.ts
          mcp-auth.ts
        sse.ts
      mcp/
        server.ts              # StreamableHTTPServerTransport + session map
        session.ts
        tools/
          session.ts
          projects.ts
          issues.ts
          attachments.ts
          links.ts
          comments.ts
        shapes.ts
      services/
        attachments.ts         # copy, hash, dedupe, text sidecar
        pdf.ts                 # best-effort text extraction
        open-with-os.ts
        backup.ts
        export.ts
        paths.ts
        ids.ts
        clock.ts
    web/
      main.tsx
      App.tsx
      routes/
        BoardRoute.tsx
        IssueRoute.tsx
        SettingsRoute.tsx
      components/
        board/
        drawer/
        filters/
        command/
        common/
      api/
        client.ts
        queries.ts
        sse.ts
      state/
        local.ts               # theme, density, saved views
      styles/
        index.css
  test/
    docs.test.mjs              # existing docs guard
    plan.test.mjs              # plan index/spec guard
    schema.test.mjs            # executes the v1 schema from the spec
    unit/
    integration/
    concurrency/
    mcp/
    ui/
  scripts/
    install-startup.ps1
    uninstall-startup.ps1
    backup.ps1
    export.ps1
  dist/
    server/
    web/
```

`dist/` is generated and ignored. The data directory is outside the repository.

## Toolchain

| Concern | Choice |
|---|---|
| Runtime | Node 24 (installed) |
| Language | TypeScript, strict, ESM |
| Server | Express 5 |
| MCP | `@modelcontextprotocol/sdk` |
| Validation | Zod |
| Database | `node:sqlite` (`DatabaseSync`) |
| Logging | `pino` + daily file transport |
| Uploads | `multer` or `busboy` |
| MIME sniffing | `file-type` |
| IDs | `uuid` v7 |
| PDF text | `unpdf` (PDF.js wrapper); fallback to metadata |
| Zip export | `archiver` |
| UI | React, Vite, Tailwind, Radix primitives |
| Drag and drop | `@dnd-kit/core`, `@dnd-kit/sortable` |
| Server state | `@tanstack/react-query` |
| Markdown | `react-markdown`, `remark-gfm`, `rehype-sanitize` |
| Tests | Vitest, Supertest, Playwright |

Use current stable versions at M0 and pin them in `package-lock.json`. Avoid native modules; `node:sqlite` is the reason the Windows install is simple.

## Planned npm scripts

These are targets for M0, not present yet.

| Script | Command | Purpose |
|---|---|---|
| `dev` | `concurrently "tsx watch src/server/index.ts" "vite"` | Server watch + Vite dev server |
| `build` | `tsc -p tsconfig.server.json && vite build` | Server to `dist/server`, UI to `dist/web` |
| `start` | `node dist/server/index.js` | Production daemon |
| `test` | `npm run test:docs && vitest run` | All tests |
| `test:docs` | `node --test test/docs.test.mjs test/plan.test.mjs test/schema.test.mjs` | Docs/plan/schema guards |
| `test:unit` | `vitest run test/unit` | Domain and repository tests |
| `test:integration` | `vitest run test/integration` | HTTP + SQLite tests |
| `test:concurrency` | `vitest run test/concurrency` | Parallel write tests |
| `test:mcp` | `vitest run test/mcp` | MCP client tests |
| `test:ui` | `playwright test` | Browser smoke tests |
| `typecheck` | `tsc --noEmit` | Type check both projects |
| `lint` | `eslint .` | Lint |
| `format` | `prettier --write .` | Format |
| `export` | `node dist/server/scripts/export.js` | CLI export |
| `backup` | `node dist/server/scripts/backup.js` | On-demand backup |

`npm test` must run the docs/plan guards even before application tests exist. This keeps the repository honest during M0.

## Configuration files

- `tsconfig.json` — base strict config for the workspace.
- `tsconfig.server.json` — `module: NodeNext`, `moduleResolution: NodeNext`, `outDir: dist/server`. Server imports use `.js` extensions.
- `vite.config.ts` — React plugin, Tailwind plugin, root `src/web`, build output `dist/web`, dev proxy for `/api`, `/mcp`, `/healthz`, and `/api/events` to `http://127.0.0.1:4319`.
- `eslint.config.js` — flat config, TypeScript + React rules.
- `.prettierrc` — single quotes, semicolons, print width 100.
- `.gitignore` — `node_modules/`, `dist/`, `coverage/`, `test-results/`, `playwright-report/`, `*.log`, `.env*`, `*.db*`, `data/`, `attachments/`, `backups/`, `logs/`, `Thumbs.db`, `.DS_Store`.
- `.github/workflows/docs.yml` — Node 24, `node --test test/docs.test.mjs test/plan.test.mjs test/schema.test.mjs` on push and pull request. Extend to `npm test` in M0.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SHARED_CONTEXT_PORT` | `4319` | HTTP port |
| `SHARED_CONTEXT_DATA_DIR` | `%LOCALAPPDATA%\shared-context` | Data, attachments, backups, logs |
| `SHARED_CONTEXT_CONFIG` | `%APPDATA%\shared-context\config.json` | Config file path |
| `SHARED_CONTEXT_TOKEN` | generated | MCP bearer token override |
| `LOG_LEVEL` | `info` | `trace`/`debug`/`info`/`warn`/`error` |

Tests set `SHARED_CONTEXT_DATA_DIR` to a temporary directory. Never read the real user data in tests.

## Build and run model

- Development: `npm run dev` starts the API/MCP on 4319 and Vite on its own port with a proxy.
- Production: `npm run build`, then `npm start` or the Task Scheduler task.
- The server serves `dist/web` as static files and falls back to `index.html` for SPA routes, excluding `/api`, `/mcp`, and `/healthz`.
- The UI and API share an origin in production; no CORS.

## CI

Current guard (committed now):

```yaml
name: docs
on: [push, pull_request]
jobs:
  docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: node --test test/docs.test.mjs test/plan.test.mjs test/schema.test.mjs
```

In M0, add `npm ci`, `npm run typecheck`, and `npm test`. Add a Playwright job only after M4; it is slow and needs a browser install.

## M0 acceptance criteria

- `package.json` exists with the scripts above; `npm install` succeeds on Windows.
- `npm run typecheck` passes.
- `npm run test:docs` passes.
- `npm run build` produces `dist/server/index.js` and `dist/web/index.html`.
- `npm start` binds `127.0.0.1:4319` and `/healthz` reports SQLite open and WAL mode.
- The data directory is created outside the repo and ignored by git.
- No native build step is required on a clean Windows machine.
