# Shared Context — Implementation Plan

**Status:** specified; implementation not started.
**Repository:** https://github.com/zauns/shared-context
**Updated:** 2026-10-22

Shared Context is a local, multi-project issue tracker and context service for coding agents, exposed over MCP. This directory is the implementation contract: one spec per subsystem, plus a tracker for the build milestones.

## Locked decisions

| Area | Decision | Record |
|---|---|---|
| Shape | One local daemon owns the database and serves MCP, API, SSE, and UI | [ADR-0001](../docs/adr/0001-single-local-daemon.md) |
| Runtime | Node 24 + TypeScript, Express 5, `node:sqlite`, React + Vite | [01-repository-layout](01-repository-layout.md) |
| Data | One global SQLite database plus managed attachments, not per-repo databases | [ADR-0005](../docs/adr/0005-global-data-store.md) |
| Concurrency | Strict `expected_rev` plus atomic `claim_issue`; no pessimistic locks | [ADR-0002](../docs/adr/0002-optimistic-concurrency-and-atomic-claim.md) |
| Workflow | Six Stages; Blocked is an orthogonal flag with a reason | [ADR-0003](../docs/adr/0003-blocked-is-not-a-stage.md) |
| Ownership | One Assignee per Issue; Actors are attribution labels, not security principals | [02-data-model](02-data-model.md) |
| Deletion | Soft delete with retained Activity and batch restore | [ADR-0004](../docs/adr/0004-soft-delete-with-retained-activity.md) |
| Projects | Projects are UI-managed; agents operate within them | [ADR-0007](../docs/adr/0007-agents-operate-within-projects.md) |
| Attachments | Files are copied into the store; images are capability-gated; PDF text is best-effort, no OCR | [ADR-0008](../docs/adr/0008-attachments-are-copied.md) |
| Host | Run at logon in the user session, never as a Windows service | [ADR-0006](../docs/adr/0006-run-at-logon.md) |

## Specs

| Spec | Covers | Status |
|---|---|---|
| [00-overview](00-overview.md) | Goals, non-goals, architecture, glossary of the system | Specified |
| [01-repository-layout](01-repository-layout.md) | Directory tree, toolchain, scripts, dependencies, CI | Specified |
| [02-data-model](02-data-model.md) | Schema, constraints, indexes, FTS, key generation, migrations | Specified |
| [03-concurrency](03-concurrency.md) | Transactions, revisions, claims, conflicts, change feed | Specified |
| [04-mcp-tools](04-mcp-tools.md) | Transport, sessions, all MCP tool contracts | Specified |
| [05-http-api](05-http-api.md) | UI API routes, envelopes, SSE, uploads, admin endpoints | Specified |
| [06-ui](06-ui.md) | Board, drawer, filters, editing, conflict UX, settings | Specified |
| [07-attachments](07-attachments.md) | Files, PDFs, text extraction, images, OS opening | Specified |
| [08-security](08-security.md) | Threat model and controls | Specified |
| [09-operations](09-operations.md) | Config, startup, backup, export, logs, upgrades | Specified |
| [10-build-order](10-build-order.md) | Milestones M0–M7 with acceptance criteria | Specified |
| [11-test-plan](11-test-plan.md) | Unit, integration, concurrency, MCP, UI, manual tests | Specified |
| [12-risks](12-risks.md) | Risks, assumptions, early spikes, fallbacks | Specified |

## Milestone tracker

- [ ] **M0 — Scaffold**: manifest, TypeScript, Express, Vite, Vitest, config, SQLite connection, migration runner, `/healthz`, docs/plan/schema guards in CI.
- [ ] **M1 — Domain + schema**: all tables, repositories, key generation, parent cycles, progress, FTS, soft delete batches, unit tests.
- [ ] **M2 — HTTP + SSE + concurrency**: JSON API, error envelope, SSE replay, change bus, integration and concurrency tests.
- [ ] **M3 — MCP**: Streamable HTTP transport, sessions, `identify`, 23 tools, MCP integration tests.
- [ ] **M4 — Board UI**: shell, sidebar, six columns, cards, drag-and-drop, filters, URL state, SSE invalidation.
- [ ] **M5 — Issue drawer**: metadata editing, description editor, children, comments, activity, conflict banner.
- [ ] **M6 — Attachments + PDF + vision + palette**: upload/open/read, PDF extraction, capability-gated images, global palette.
- [ ] **M7 — Settings, trash, export, backup, startup**: settings, module manager, doc allowlist, trash/restore, export, Task Scheduler scripts, end-to-end verification.

## How to use this plan

- A spec is an implementation contract, not a suggestion. If the code must deviate, add or supersede an ADR and update the affected spec in the same change.
- Update the milestone tracker and the matching spec status when work lands. Do not mark a milestone complete until its acceptance criteria and tests pass.
- The glossary in [`CONTEXT.md`](../CONTEXT.md) is the vocabulary source of truth. Expand an acronym or rename a concept there first, then update the specs.
- Every spec ends with acceptance criteria. Those are the checklist for review, not a substitute for the test plan.

## Current state

- Design docs: `CONTEXT.md` and eight ADRs.
- Plan: these 13 specs.
- Code: none. No `package.json`, no `src/`, no app tests.
- CI: docs/plan/schema guard only.
