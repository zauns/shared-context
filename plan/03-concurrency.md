# 03 — Concurrency, Revisions, and the Change Feed

**Status:** partially implemented (domain); HTTP/SSE in M2

## Scope

This spec defines the write contract shared by the domain layer, the HTTP API, and MCP. It is the reason the project exists; do not bypass it with a convenient `UPDATE` in a route handler.

## Invariants

1. One process writes the database. No second daemon, no stdio server per session.
2. Every mutation runs in `BEGIN IMMEDIATE`.
3. Every core-field mutation increments `issues.rev` exactly once.
4. Every mutation that changes an Issue writes an Activity row in the same transaction.
5. Activity rows are append-only; `activities.id` is the global change cursor.
6. `claim_issue` is a single atomic SQL statement; it never relies on a read-then-write.
7. No file I/O or `await` inside a database transaction.
8. SSE and `wait_for_change` fire only after `COMMIT`.

## Transaction helper

```ts
function withImmediateTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
```

The callback must be synchronous. Attachment copies and PDF extraction happen before or after the transaction, never inside it.

## Mutation pipeline

```
1. Resolve actor and project.
2. Validate input with Zod.
3. withImmediateTransaction:
   a. Load the current Issue (including deleted_at).
   b. If required, compare expected_rev.
   c. Validate state transitions and cross-entity rules.
   d. UPDATE ... WHERE id = ? AND rev = ? (second guard).
   e. Increment rev, set updated_at.
   f. Insert the Activity row.
4. After commit: publish the event to the SSE hub and wake waiters.
5. Return the affected entity and the new activity id.
```

If the `UPDATE ... WHERE id = ? AND rev = ?` affects zero rows after the explicit check, treat it as a conflict and roll back. This is a defense against a logic bug, not an expected path.

## Revision rules

| Operation | `expected_rev` | Bumps `issues.rev` | Activity type |
|---|---|---|---|
| `create_issue` | n/a | starts at 1 | `issue.created` |
| `update_issue` | required | yes | `issue.updated` |
| `move_issue` | required | yes | `issue.moved` |
| `claim_issue` | optional | yes, unless already owned by caller | `issue.claimed` |
| `release_issue` | optional | yes, unless already unassigned | `issue.released` |
| `block_issue` | required | yes, unless same reason already set | `issue.blocked` |
| `unblock_issue` | required | yes, unless already unblocked | `issue.unblocked` |
| `delete_issue` | required | yes, per deleted Issue | `issue.deleted` |
| `restore_issue` (UI) | optional | yes, per restored Issue | `issue.restored` |
| `add_attachment` | n/a | no | `attachment.added` |
| `remove_attachment` | n/a | no | `attachment.removed` |
| `add_link` | n/a | no | `link.added` |
| `remove_link` | n/a | no | `link.removed` |
| `add_comment` | n/a | no | `comment.added` |
| `update_comment` (UI) | comment `rev` | no | `comment.updated` |
| `delete_comment` (UI) | optional | no | `comment.deleted` |

No-op mutations do not bump `rev` and do not write Activity. Return the current entity with `changed: false`.

## Conflict response

```json
{
  "ok": false,
  "error": {
    "code": "conflict",
    "message": "Issue changed since revision 12",
    "details": { "expected_rev": 12, "current_rev": 14 }
  },
  "issue": { "...current IssueDetail..." }
}
```

The current Issue is included so an agent can re-read and retry without another round trip. The MCP tool sets `isError: true` and includes this JSON as text content.

## Claim

```sql
UPDATE issues
SET assignee_id = :actor_id,
    stage = CASE WHEN stage IN ('backlog', 'todo') THEN 'in_progress' ELSE stage END,
    rev = rev + 1,
    updated_at = :now
WHERE id = :issue_id
  AND deleted_at IS NULL
  AND stage NOT IN ('done', 'cancelled')
  AND (assignee_id IS NULL OR assignee_id = :actor_id);
```

Then insert the Activity row in the same transaction.

Outcomes:

- One row updated: `claimed: true`, return the new Issue.
- Zero rows because the Issue is already owned by the caller: `claimed: false`, `already_owned: true`, no rev bump.
- Zero rows because another Actor owns it: `claim_conflict` with the current Issue.
- Zero rows because the Issue is done/cancelled: `invalid_state`.
- Zero rows because it is deleted/missing: `not_found`.
- `expected_rev` was supplied and does not match: `conflict` before the claim attempt.

Claiming moves `backlog` and `todo` to `in_progress`; it leaves `review` in `review`. A human may want to claim in review; that is allowed.

## Release

- Only the current Assignee or an Actor with `kind = human` may release.
- If unassigned, return `released: false`; no rev bump.
- Clear `assignee_id`, bump `rev`, write Activity, leave the Stage unchanged.

## Move

- `stage` is required; `position` is optional.
- If `position` is omitted, append: `max(position) + 1024` in the target Stage.
- If `position` is provided, insert at the midpoint between its neighbors; if the gap is below `0.001`, renumber the target column in the same transaction and recompute.
- Moving to `done` sets `completed_at = now` and clears `cancelled_at`.
- Moving to `cancelled` sets `cancelled_at = now` and clears `completed_at`.
- Moving to any other Stage clears both timestamps.
- The blocked flag is untouched by a move.
- Reordering within the same Stage is a normal mutation with the same `expected_rev` rules.

## Block and unblock

- `block_issue` requires a reason of 1–2000 characters.
- It sets `blocked = 1`, `blocked_reason`, `blocked_at`, `blocked_by`; the Stage does not change.
- Blocking an already blocked Issue with the same reason is a no-op.
- Blocking with a different reason updates the reason and writes Activity.
- `unblock_issue` clears the four fields; unblocking an unblocked Issue is a no-op.
- Both require `expected_rev`.

## Delete and restore

- Deleting a single Issue with no children creates one `deletion_batch` and soft-deletes it.
- Deleting an Issue with children requires `cascade: true`; otherwise return `has_children` with the active child count.
- Cascade collects the subtree with a recursive CTE and soft-deletes every row in one batch.
- Each deleted Issue gets a `rev` bump and an `issue.deleted` Activity row. The root Activity records `cascade_count`.
- Restore is UI-only. It restores every Issue with the same `deletion_batch`. It refuses if the deleted Issue's parent is still deleted in a different batch.
- Attachments and comments are not deleted; they remain attached to the soft-deleted Issue.
- A hard purge is not part of v1.

## Idempotent create

`create_issue` accepts `client_request_id` (1–128 chars). Before allocating a key, check:

```sql
SELECT * FROM issues
WHERE project_id = :project_id AND client_request_id = :client_request_id;
```

If a row exists, return it with `created: false`. The partial unique index is the final guard; on a race, catch the constraint error and return the existing row. This makes agent retries safe.

## Change feed

### Event shape

```json
{
  "id": 123,
  "type": "issue.updated",
  "project_id": "uuid",
  "issue_id": "uuid",
  "issue_key": "SHC-42",
  "rev": 14,
  "actor": { "id": "uuid", "name": "frontend-agent" },
  "at": "2026-10-22T14:03:11.123Z",
  "changes": [
    { "field": "priority", "from": "low", "to": "high" }
  ]
}
```

### `wait_for_change`

- Input: `since_activity_id`, optional `project`, `timeout_seconds` (1–60, default 60).
- If `since_activity_id` is greater than the current max, return `cursor_invalid`.
- Query persisted Activity rows with `id > since` (and matching project) first.
- If none, subscribe to the in-process bus and wait.
- On a commit, resolve waiters whose project matches or that have no project filter.
- On timeout, return `{ events: [], timed_out: true, cursor: current }`.
- Never poll the database on a timer.

The bus is a `Map<projectId | '*', Set<resolver>>`. The commit path publishes after `COMMIT`; a waiter that arrives between the read and the subscribe must re-query before blocking to avoid a lost wake-up.

### SSE

- `GET /api/events` is the UI feed. Event `id` is the Activity id.
- On connect, replay events after `Last-Event-ID`/`since`, capped at 1,000. If the gap is larger, emit a `resync` event with the current cursor and let the client refetch.
- Heartbeat comment every 15 seconds.
- SSE is best-effort; the UI refetches on reconnect.

## Error codes

| Code | Meaning |
|---|---|
| `validation_error` | Bad input, enum, length, URL, or malformed FTS query |
| `not_found` | Issue/Project/Attachment/Comment missing or soft-deleted where not allowed |
| `conflict` | `expected_rev` mismatch |
| `claim_conflict` | Another Actor owns the Issue |
| `invalid_state` | Claim on done/cancelled, restore of a non-deleted Issue, etc. |
| `has_children` | Delete without `cascade` |
| `parent_cycle` | Parent change would create a cycle |
| `parent_project_mismatch` | Parent belongs to another Project |
| `module_not_found` | Unknown Module |
| `actor_not_found` | Unknown Actor |
| `actor_required` | No session Actor and no per-call override |
| `project_required` | No session Project and no argument |
| `cursor_invalid` | Cursor greater than the current max |
| `attachment_too_large` | Over 25 MB |
| `unsupported_type` | Not in the attachment allowlist |
| `attachment_copy_failed` | Filesystem failure while staging/copying |
| `doc_not_allowed` | Project doc outside the allowlist |
| `unauthorized` | Missing/invalid MCP bearer token |

## Guarantees and non-guarantees

Guaranteed:

- No lost updates for core Issue fields.
- No double claims.
- Mutation and Activity are atomic.
- Every committed change is visible to the next read.
- A waiter is woken after commit, not before.

Not guaranteed:

- Two agents editing the same description without one retrying. One gets `409`; that is the contract.
- Ordering of independent SSE events beyond the Activity id order.
- Exactly-once delivery of SSE; clients must resync.

## Test matrix

- 20 parallel `update_issue` at the same rev: one 200, 19 conflicts, final rev +1.
- 20 parallel `claim_issue` from different Actors: one winner, one Assignee.
- Parallel `move_issue` + `update_issue`: one wins.
- 10 identical `client_request_id` creates: one Issue.
- `wait_for_change` wakes within 1 second of a commit.
- A failed transaction leaves no Activity row and no rev change.
- A no-op mutation leaves no Activity row.
- Block/unblock keeps Stage unchanged.
- Cascade delete + batch restore round-trips.

## Acceptance criteria

- Every write path goes through the transaction helper and the domain service.
- No route handler contains raw mutation SQL.
- Conflict responses include the current Issue.
- `claim_issue` is a single atomic statement plus the Activity insert.
- `wait_for_change` never polls.
- The concurrency test suite passes before M3 starts.
