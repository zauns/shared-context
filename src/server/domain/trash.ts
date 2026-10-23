import type { Database } from '../db/connection.js';
import { withImmediateTransaction } from '../db/connection.js';
import { findIssueById, restoreRows, rowsForBatch } from '../db/repositories/issues.js';
import { findProjectRow } from '../db/repositories/projects.js';
import { getActorRef, requireActorRow } from './actors.js';
import { recordActivity } from './activity.js';
import { DomainError } from './errors.js';
import { nowIso } from './time.js';
import type { IssueRef, TrashBatch } from './types.js';

interface DeletedIssueRow {
  id: string;
  key: string;
  title: string;
  deleted_at: string;
  deleted_by: string | null;
  deletion_batch: string;
}

function requireProject(db: Database, ref: string) {
  const project = findProjectRow(db, ref);
  if (!project) {
    throw new DomainError('not_found', `Project not found: ${ref}`);
  }
  return project;
}

export function listTrashBatches(db: Database, projectRef: string): TrashBatch[] {
  const project = requireProject(db, projectRef);
  const rows = db
    .prepare(
      `SELECT id, key, title, deleted_at, deleted_by, deletion_batch
       FROM issues
       WHERE project_id = ? AND deleted_at IS NOT NULL AND deletion_batch IS NOT NULL
       ORDER BY deleted_at DESC, key`,
    )
    .all(project.id) as unknown as DeletedIssueRow[];

  const batches = new Map<string, TrashBatch>();
  for (const row of rows) {
    const issue: IssueRef = { id: row.id, key: row.key, title: row.title };
    const existing = batches.get(row.deletion_batch);
    if (existing) {
      existing.issues.push(issue);
      continue;
    }
    batches.set(row.deletion_batch, {
      batch: row.deletion_batch,
      deleted_at: row.deleted_at,
      deleted_by: row.deleted_by ? getActorRef(db, row.deleted_by) : null,
      issues: [issue],
    });
  }
  return [...batches.values()];
}

export interface RestoreTrashBatchInput {
  project: string;
  batch: string;
  actor: string;
}

export interface RestoreTrashBatchResult {
  restored: IssueRef[];
  batch: string;
}

export function restoreTrashBatch(
  db: Database,
  input: RestoreTrashBatchInput,
): RestoreTrashBatchResult {
  const project = requireProject(db, input.project);
  const actor = requireActorRow(db, input.actor);
  const rows = rowsForBatch(db, input.batch);
  if (rows.length === 0 || rows.some((row) => row.project_id !== project.id)) {
    throw new DomainError('not_found', `Deletion batch not found: ${input.batch}`);
  }
  for (const row of rows) {
    if (!row.parent_id) continue;
    const parent = findIssueById(db, row.parent_id);
    if (parent?.deleted_at && parent.deletion_batch !== input.batch) {
      throw new DomainError(
        'parent_deleted',
        'A parent Issue is deleted in a different batch',
      );
    }
  }

  const now = nowIso();
  withImmediateTransaction(db, () => {
    restoreRows(db, input.batch, now);
    for (const row of rows) {
      recordActivity(db, {
        project_id: project.id,
        issue_id: row.id,
        actor,
        type: 'issue.restored',
        changes: [{ field: 'batch', from: input.batch, to: null }],
      });
    }
  });

  return {
    restored: rows.map(({ id, key, title }) => ({ id, key, title })),
    batch: input.batch,
  };
}