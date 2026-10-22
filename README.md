# Shared Context

A local, multi-project issue tracker and context service for coding agents, exposed over MCP.

**Status:** specified; implementation has not started. The repository currently contains the design glossary, decision records, and the implementation plan.

## Start here

- [`plan/README.md`](plan/README.md) — plan index, locked decisions, milestone tracker.
- [`CONTEXT.md`](CONTEXT.md) — domain glossary (the vocabulary source of truth).
- [`docs/adr/`](docs/adr/) — eight decision records.
- [`AGENTS.md`](AGENTS.md) — project memory for coding agents.

## What it will be

One local daemon on `127.0.0.1:4319` owns a SQLite database and serves:

- `/mcp` — Streamable HTTP MCP for Reasonix and other agents.
- `/api` — JSON API for the kanban UI.
- `/api/events` — SSE change feed.
- the React UI — board, drawer, filters, comments, activity, attachments.

Planned stack: Node 24 + TypeScript, Express 5, `node:sqlite`, React + Vite. No Docker, no cloud, no Windows service.

## Current verification

```sh
node --test test/docs.test.mjs test/plan.test.mjs test/schema.test.mjs
```

This checks the glossary, the ADRs, the plan index/spec links, and executes the v1 schema against an in-memory SQLite database. There is no `package.json` or application code yet; do not expect `npm test`, `npm run build`, or `npm start` to work until M0.

## Repository

https://github.com/zauns/shared-context
