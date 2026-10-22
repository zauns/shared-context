# 00 — Overview

**Status:** specified
**Depends on:** [CONTEXT.md](../CONTEXT.md), [ADR index](../docs/adr/)
**Feeds:** every other spec

## Purpose

Shared Context is personal infrastructure for one developer and several concurrent coding agents. It replaces the ad-hoc mix of notes, chat messages, and "what was I doing?" with a durable Issue tracker that agents can read and write through MCP, and a kanban board that the human can see and curate.

It is local by design: one machine, one owner, no accounts, no cloud, no multi-tenant authorization.

## Goals

1. Track Issues across multiple Projects with a stable human key (`SHC-42`).
2. Let agents create, update, claim, block, comment on, and delete Issues through a small, explicit MCP surface.
3. Make every write safe under concurrency: no lost updates, no double claims, no silent overwrites.
4. Make the current state readable at any moment by any agent, with a cursor-based change feed for agents that want to wait.
5. Show a kanban board with filters, hierarchy, progress, attachments, and activity.
6. Keep the whole thing operable by one person: start at logon, back up daily, export on demand.

## Non-goals

- Multi-user accounts, roles, or per-user permissions.
- Sprints, estimates, time tracking, burndown charts, custom workflows, or WIP limits.
- Notifications, email, chat integration, or agent orchestration.
- Import from Jira, GitHub Issues, Linear, or other trackers.
- Code indexing, semantic search, or a second file browser.
- OCR of scanned PDFs.
- Mobile-first UI or offline support.
- Cloud sync or remote access.

## Users and use cases

**The owner (human).** Creates Projects, curates Modules, reviews the board, edits descriptions, restores deleted Issues, opens attachments, and backs up the store.

**An agent session.** Identifies itself, reads a Context Snapshot, claims an Issue, edits it with an expected Revision, comments on a blocker, moves it to review, and waits for a change.

**A subagent.** Shares an MCP connection with its parent but identifies itself per call when it needs distinct attribution.

Core use cases:

1. "Create a backend fix for project `SHC`, priority high, module `backend-fix`, as a child of `SHC-12`."
2. "Show me every blocked Issue in `SHC`, with reasons."
3. "Claim the next todo Issue and move it to in progress."
4. "Two agents try to claim the same Issue; exactly one wins."
5. "An agent edits a description while another adds an attachment; neither loses the other's change."
6. "Attach a screenshot and a PDF, then open them with the Windows default applications."
7. "Filter the board by assignee, module, priority, and blocked state, and save the view."
8. "Back up the database and attachments, then restore the previous day."

## Architecture

```
Reasonix session A ─┐
Reasonix session B ─┼── HTTP ──> shared-context daemon (127.0.0.1:4319)
Browser UI ─────────┘             ├─ /mcp           Streamable HTTP MCP
                                  ├─ /api           JSON API for the UI
                                  ├─ /api/events    SSE change feed
                                  └─ SQLite + attachments + backups
```

One native Node process is the only writer. It owns the SQLite database, the attachment store, the MCP endpoint, the UI API, and the SSE stream. The UI is a client of the same domain services as MCP; it is not a second backend.

### Runtime model

- Node 24, TypeScript strict, Express 5.
- SQLite through the built-in `node:sqlite` module, WAL mode, `BEGIN IMMEDIATE` for writes.
- MCP over Streamable HTTP with stateful sessions and a bearer token.
- React + Vite SPA served from the same origin.
- No Docker, no cloud dependency, no Windows service. Task Scheduler starts the daemon at logon.

### Write path

```
MCP tool / HTTP route
  -> validation (Zod)
  -> domain service
  -> BEGIN IMMEDIATE
       read current row
       check expected_rev
       update row + bump rev
       insert Activity row
     COMMIT
  -> emit SSE event
  -> wake wait_for_change waiters
  -> return the affected entity
```

File operations (attachment copy, PDF extraction) happen outside the SQL transaction: stage the file, then commit the metadata, then move the file into its final directory. A failed transaction leaves no metadata; an orphaned staged file is cleaned on startup.

### Read path

- Board and detail reads are ordinary consistent SQLite reads.
- `wait_for_change` blocks on an in-process event bus keyed by the global Activity cursor.
- SSE replays from the Activity table on reconnect.

## Key decisions

| Decision | Why | Record |
|---|---|---|
| One daemon, not stdio per session | Single writer, one event bus, one UI, no cross-process lock contention | [ADR-0001](../docs/adr/0001-single-local-daemon.md) |
| Revisions + atomic claim | Prevent lost updates and double ownership without lock expiry or deadlocks | [ADR-0002](../docs/adr/0002-optimistic-concurrency-and-atomic-claim.md) |
| Blocked is a flag | A blocked Issue keeps its real Stage | [ADR-0003](../docs/adr/0003-blocked-is-not-a-stage.md) |
| Soft delete | Preserve Activity and restore subtrees | [ADR-0004](../docs/adr/0004-soft-delete-with-retained-activity.md) |
| One global data store | One backup, cross-project search, no live DB in git or OneDrive | [ADR-0005](../docs/adr/0005-global-data-store.md) |
| Start at logon | The daemon must open files in the user's desktop session | [ADR-0006](../docs/adr/0006-run-at-logon.md) |
| Projects are UI-managed | Stable project keys; agents cannot create project sprawl | [ADR-0007](../docs/adr/0007-agents-operate-within-projects.md) |
| Attachments copied, images gated | Stable backup-able files; no images sent to non-vision models | [ADR-0008](../docs/adr/0008-attachments-are-copied.md) |

## Success criteria

- Two agents can create and update Issues concurrently with no lost updates; stale writes return a conflict and a fresh Issue.
- Twenty concurrent claims on one Issue produce exactly one Assignee.
- The board reflects a committed change in under one second on the same machine.
- A blocked Issue shows a reason without leaving its Stage.
- A parent card shows `done/active` progress without expanding.
- A PNG and a PDF with spaces in their filenames can be attached and opened with their default Windows applications.
- A daily backup can be restored into a working daemon.
- `npm test` runs the unit, integration, concurrency, MCP, and docs/plan guards green.

## Boundaries

- Everything is local to `127.0.0.1`.
- The MCP token is a local access control, not a multi-user authorization system.
- Actors are attribution labels. An agent can name itself; that name is not an identity proof.
- The database is the source of truth. Markdown/JSON exports are snapshots, not a sync format.
- Attachments are retained until a deliberate purge, which is not part of v1.

## Acceptance criteria

- This spec names every subsystem and links to its detailed spec.
- Every locked decision has an ADR or a detailed spec.
- The non-goals are explicit enough to reject scope creep without a new ADR.
- The success criteria are testable.
