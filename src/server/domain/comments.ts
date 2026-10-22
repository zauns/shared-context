import type { Database } from '../db/connection.js';
import { withImmediateTransaction } from '../db/connection.js';
import {
  findCommentRow,
  insertCommentRow,
  listCommentRows,
  softDeleteCommentRow,
  updateCommentRow,
} from '../db/repositories/comments.js';
import type { CommentRow } from '../db/repositories/rows.js';
import { DomainError } from './errors.js';
import { newId } from './ids.js';
import { nowIso } from './time.js';
import { actorRowToRef, requireActorRow } from './actors.js';
import { recordActivity } from './activity.js';
import { requireIssueRow } from './issues.js';
import type { Comment } from './types.js';
import { assertExpectedRev, assertNonEmpty } from './validation.js';

export function commentRowToComment(db: Database, row: CommentRow): Comment {
  return {
    id: row.id,
    body: row.body,
    author: actorRowToRef(requireActorRow(db, row.author_id)),
    rev: row.rev,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface AddCommentInput {
  issue: string;
  body: string;
  actor: string;
}

export function addComment(db: Database, input: AddCommentInput): Comment {
  const issue = requireIssueRow(db, input.issue);
  const actor = requireActorRow(db, input.actor);
  const body = assertNonEmpty(input.body, 'comment', 65536);
  const now = nowIso();
  const row: CommentRow = {
    id: newId(),
    issue_id: issue.id,
    body,
    author_id: actor.id,
    rev: 1,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    deleted_by: null,
  };
  withImmediateTransaction(db, () => {
    insertCommentRow(db, row);
    recordActivity(db, {
      project_id: issue.project_id,
      issue_id: issue.id,
      actor,
      type: 'comment.added',
      changes: [{ field: 'comment', to: { id: row.id, excerpt: body.slice(0, 200) } }],
    });
  });
  return commentRowToComment(db, row);
}

export function listComments(
  db: Database,
  issueRef: string,
  limit = 50,
  before?: string,
): Comment[] {
  const issue = requireIssueRow(db, issueRef);
  return listCommentRows(db, issue.id, Math.min(Math.max(limit, 1), 200), before).map((row) =>
    commentRowToComment(db, row),
  );
}

export interface UpdateCommentInput {
  comment_id: string;
  body: string;
  expected_rev: number;
  actor: string;
}

export function updateComment(db: Database, input: UpdateCommentInput): Comment {
  const row = findCommentRow(db, input.comment_id);
  if (!row || row.deleted_at) {
    throw new DomainError('not_found', `Comment not found: ${input.comment_id}`);
  }
  const actor = requireActorRow(db, input.actor);
  if (actor.id !== row.author_id && actor.kind !== 'human') {
    throw new DomainError('unauthorized', 'Only the author or a human Actor may edit a comment');
  }
  assertExpectedRev(input.expected_rev);
  if (row.rev !== input.expected_rev) {
    throw new DomainError('conflict', 'Comment changed since the expected revision', {
      details: { expected_rev: input.expected_rev, current_rev: row.rev },
    });
  }
  const body = assertNonEmpty(input.body, 'comment', 65536);
  const issue = requireIssueRow(db, row.issue_id);
  const now = nowIso();
  withImmediateTransaction(db, () => {
    const updated = updateCommentRow(db, row.id, body, row.rev + 1, now, row.rev);
    if (updated === 0) {
      throw new DomainError('conflict', 'Comment changed since the expected revision');
    }
    recordActivity(db, {
      project_id: issue.project_id,
      issue_id: issue.id,
      actor,
      type: 'comment.updated',
      changes: [{ field: 'comment', to: { id: row.id, excerpt: body.slice(0, 200) } }],
    });
  });
  return commentRowToComment(db, findCommentRow(db, row.id) ?? row);
}

export interface DeleteCommentInput {
  comment_id: string;
  actor: string;
}

export function deleteComment(db: Database, input: DeleteCommentInput): void {
  const row = findCommentRow(db, input.comment_id);
  if (!row || row.deleted_at) {
    throw new DomainError('not_found', `Comment not found: ${input.comment_id}`);
  }
  const actor = requireActorRow(db, input.actor);
  if (actor.id !== row.author_id && actor.kind !== 'human') {
    throw new DomainError('unauthorized', 'Only the author or a human Actor may delete a comment');
  }
  const issue = requireIssueRow(db, row.issue_id);
  const now = nowIso();
  withImmediateTransaction(db, () => {
    softDeleteCommentRow(db, row.id, now, actor.id);
    recordActivity(db, {
      project_id: issue.project_id,
      issue_id: issue.id,
      actor,
      type: 'comment.deleted',
      changes: [{ field: 'comment', from: { id: row.id, excerpt: row.body.slice(0, 200) }, to: null }],
    });
  });
}
