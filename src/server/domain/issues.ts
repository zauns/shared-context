import type { Database } from '../db/connection.js';
import { withImmediateTransaction } from '../db/connection.js';
import { findActorRow } from '../db/repositories/actors.js';
import { findModuleById, findModuleRow } from '../db/repositories/modules.js';
import { findProjectRow } from '../db/repositories/projects.js';
import { listAttachmentRows } from '../db/repositories/attachments.js';
import { listCommentRows } from '../db/repositories/comments.js';
import {
  allocateIssueNumber,
  countActiveChildren,
  countAttachments,
  countComments,
  countIssueRows,
  findIssueByClientRequestId,
  findIssueById,
  findIssueRow,
  insertIssueRow,
  listChildRows,
  listIssueRows,
  listSubtreeRows,
  nextPosition,
  progressForParent,
  restoreRows,
  rowsForBatch,
  softDeleteRows,
  updateIssueRow,
  type IssueCursor,
  type IssueQuery,
} from '../db/repositories/issues.js';
import { listLinkRows } from '../db/repositories/links.js';
import type { ActorRow, IssueRow } from '../db/repositories/rows.js';
import { DomainError, conflict } from './errors.js';
import { newBatchId, newId } from './ids.js';
import { nowIso } from './time.js';
import { getActorRef, requireActorRow } from './actors.js';
import { currentActivityCursor, listIssueActivity, recordActivity } from './activity.js';
import { moduleRowToModule } from './modules.js';
import { projectRowToSummary } from './project-summary.js';
import {
  assertExpectedRev,
  assertFiniteNumber,
  assertHttpUrl,
  assertNonEmpty,
  assertOptionalLength,
  assertPriority,
  assertStage,
} from './validation.js';
import {
  STAGES,
  type ActivityChange,
  type ActorRef,
  type Attachment,
  type Comment,
  type IssueCard,
  type IssueDetail,
  type IssueRef,
  type Link,
  type Priority,
  type Stage,
} from './types.js';

function actorRefOrFallback(db: Database, id: string): ActorRef {
  return (
    getActorRef(db, id) ?? {
      id,
      name: 'unknown',
      kind: 'agent',
      can_read_images: false,
      color: null,
    }
  );
}

export function requireIssueRow(db: Database, ref: string, includeDeleted = false): IssueRow {
  const row = findIssueRow(db, ref, includeDeleted);
  if (!row) {
    throw new DomainError('not_found', `Issue not found: ${ref}`);
  }
  return row;
}

export function issueRowToCard(db: Database, row: IssueRow): IssueCard {
  const moduleRow = row.module_id ? findModuleById(db, row.module_id) : undefined;
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    stage: row.stage as Stage,
    priority: row.priority as Priority,
    assignee: row.assignee_id ? getActorRef(db, row.assignee_id) : null,
    module: moduleRow ? moduleRowToModule(moduleRow) : null,
    blocked: row.blocked === 1,
    blocked_reason: row.blocked_reason,
    attachment_count: countAttachments(db, row.id),
    comment_count: countComments(db, row.id),
    child_progress: progressForParent(db, row.id),
    position: row.position,
    rev: row.rev,
    updated_at: row.updated_at,
  };
}

function linkRowToLink(db: Database, row: ReturnType<typeof listLinkRows>[number]): Link {
  return {
    id: row.id,
    url: row.url,
    label: row.label,
    created_by: actorRefOrFallback(db, row.created_by),
    created_at: row.created_at,
  };
}

function attachmentRowToAttachment(
  db: Database,
  row: ReturnType<typeof listAttachmentRows>[number],
): Attachment {
  return {
    id: row.id,
    original_name: row.original_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    sha256: row.sha256,
    created_by: actorRefOrFallback(db, row.created_by),
    created_at: row.created_at,
    has_text: row.text_path !== null,
    is_image: row.mime_type.startsWith('image/'),
  };
}

function commentRowToComment(
  db: Database,
  row: ReturnType<typeof listCommentRows>[number],
): Comment {
  return {
    id: row.id,
    body: row.body,
    author: actorRefOrFallback(db, row.author_id),
    rev: row.rev,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface IssueDetailOptions {
  activityLimit?: number;
  commentLimit?: number;
}

export function issueRowToDetail(
  db: Database,
  row: IssueRow,
  options: IssueDetailOptions = {},
): IssueDetail {
  const project = findProjectRow(db, row.project_id);
  if (!project) {
    throw new DomainError('internal_error', `Missing project for issue ${row.id}`);
  }
  const parent = row.parent_id ? findIssueById(db, row.parent_id) : undefined;
  const card = issueRowToCard(db, row);
  return {
    ...card,
    project: { id: project.id, key: project.key, name: project.name },
    number: row.number,
    description: row.description,
    parent: parent ? { id: parent.id, key: parent.key, title: parent.title } : null,
    children: listChildRows(db, row.id).map((child) => issueRowToCard(db, child)),
    links: listLinkRows(db, row.id).map((link) => linkRowToLink(db, link)),
    attachments: listAttachmentRows(db, row.id).map((attachment) =>
      attachmentRowToAttachment(db, attachment),
    ),
    comments: listCommentRows(db, row.id, options.commentLimit ?? 50).map((comment) =>
      commentRowToComment(db, comment),
    ),
    activity: listIssueActivity(db, row.id, options.activityLimit ?? 50),
    created_by: actorRefOrFallback(db, row.created_by),
    created_at: row.created_at,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at,
    blocked_at: row.blocked_at,
    blocked_by: row.blocked_by ? actorRefOrFallback(db, row.blocked_by) : null,
    latest_activity_id: currentActivityCursor(db),
  };
}

function assertParentForIssue(
  db: Database,
  issue: IssueRow,
  parentRef: string,
): IssueRow {
  const parent = requireIssueRow(db, parentRef);
  if (parent.id === issue.id) {
    throw new DomainError('parent_cycle', 'An Issue cannot be its own parent');
  }
  if (parent.project_id !== issue.project_id) {
    throw new DomainError('parent_project_mismatch', 'Parent belongs to another Project');
  }
  const cycle = db
    .prepare(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id FROM issues WHERE parent_id = ?
         UNION ALL
         SELECT i.id FROM issues i JOIN descendants d ON i.parent_id = d.id
       )
       SELECT 1 AS cycle FROM descendants WHERE id = ? LIMIT 1`,
    )
    .get(issue.id, parent.id) as unknown as { cycle: number } | undefined;
  if (cycle) {
    throw new DomainError('parent_cycle', 'Parent change would create a cycle');
  }
  return parent;
}

export interface CreateIssueInput {
  project: string;
  title: string;
  description?: string;
  stage?: string;
  priority?: string;
  assignee?: string;
  module?: string;
  parent?: string;
  links?: { url: string; label?: string }[];
  client_request_id?: string;
  actor: string;
}

export interface CreateIssueResult {
  created: boolean;
  issue: IssueDetail;
}

export function createIssue(db: Database, input: CreateIssueInput): CreateIssueResult {
  const project = findProjectRow(db, input.project);
  if (!project) {
    throw new DomainError('not_found', `Project not found: ${input.project}`);
  }
  const actor = requireActorRow(db, input.actor);
  const title = assertNonEmpty(input.title, 'title', 500);
  const description = assertOptionalLength(input.description ?? '', 'description', 262144) ?? '';
  const stage = assertStage(input.stage ?? 'backlog');
  const priority = assertPriority(input.priority ?? 'none');
  const assignee = input.assignee ? requireActorRow(db, input.assignee) : null;
  const module = input.module ? findModuleRow(db, project.id, input.module) : null;
  if (input.module && !module) {
    throw new DomainError('module_not_found', `Module not found: ${input.module}`);
  }
  const parent = input.parent ? requireIssueRow(db, input.parent) : null;
  if (parent && parent.project_id !== project.id) {
    throw new DomainError('parent_project_mismatch', 'Parent belongs to another Project');
  }
  if (input.client_request_id && input.client_request_id.length > 128) {
    throw new DomainError('validation_error', 'client_request_id is too long');
  }
  const links = input.links ?? [];
  if (links.length > 20) {
    throw new DomainError('validation_error', 'At most 20 links may be attached at creation');
  }
  for (const link of links) {
    assertHttpUrl(link.url);
    if (link.label && link.label.length > 200) {
      throw new DomainError('validation_error', 'Link label is too long');
    }
  }

  let created = true;
  let issueId: string;
  try {
    issueId = withImmediateTransaction(db, () => {
      if (input.client_request_id) {
        const existing = findIssueByClientRequestId(db, project.id, input.client_request_id);
        if (existing) {
          created = false;
          return existing.id;
        }
      }
      const now = nowIso();
      const number = allocateIssueNumber(db, project.id, now);
      const id = newId();
      const row: IssueRow = {
        id,
        project_id: project.id,
        number,
        key: `${project.key}-${number}`,
        title,
        description,
        stage,
        priority,
        assignee_id: assignee?.id ?? null,
        module_id: module?.id ?? null,
        parent_id: parent?.id ?? null,
        blocked: 0,
        blocked_reason: null,
        blocked_at: null,
        blocked_by: null,
        position: nextPosition(db, project.id, stage),
        rev: 1,
        created_by: actor.id,
        created_at: now,
        updated_at: now,
        completed_at: null,
        cancelled_at: null,
        deleted_at: null,
        deleted_by: null,
        deletion_batch: null,
        client_request_id: input.client_request_id ?? null,
      };
      insertIssueRow(db, row);
      for (const link of links) {
        db.prepare(
          `INSERT INTO issue_links (id, issue_id, url, label, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(newId(), id, link.url, link.label ?? null, actor.id, now);
      }
      recordActivity(db, {
        project_id: project.id,
        issue_id: id,
        actor,
        type: 'issue.created',
        changes: [
          {
            field: 'snapshot',
            to: {
              title,
              stage,
              priority,
              module: module?.slug ?? null,
              parent: parent?.key ?? null,
              assignee: assignee?.name ?? null,
            },
          },
        ],
      });
      return id;
    });
  } catch (error) {
    if (input.client_request_id && String(error).includes('UNIQUE constraint failed')) {
      const existing = findIssueByClientRequestId(db, project.id, input.client_request_id);
      if (existing) {
        return { created: false, issue: issueRowToDetail(db, existing) };
      }
    }
    throw error;
  }

  return {
    created,
    issue: issueRowToDetail(db, requireIssueRow(db, issueId)),
  };
}

export interface UpdateIssueInput {
  issue: string;
  expected_rev: number;
  title?: string;
  description?: string;
  priority?: string;
  assignee?: string | null;
  module?: string | null;
  parent?: string | null;
  actor: string;
}

export interface ChangeResult {
  changed: boolean;
  issue: IssueDetail;
}

export function updateIssue(db: Database, input: UpdateIssueInput): ChangeResult {
  const current = requireIssueRow(db, input.issue);
  const actor = requireActorRow(db, input.actor);
  assertExpectedRev(input.expected_rev);
  if (current.rev !== input.expected_rev) {
    conflict(`Issue changed since revision ${input.expected_rev}`, issueRowToDetail(db, current));
  }

  const fields: Partial<
    Pick<IssueRow, 'title' | 'description' | 'priority' | 'assignee_id' | 'module_id' | 'parent_id'>
  > = {};
  const changes: ActivityChange[] = [];

  if (input.title !== undefined) {
    const title = assertNonEmpty(input.title, 'title', 500);
    if (title !== current.title) {
      fields.title = title;
      changes.push({ field: 'title', from: current.title, to: title });
    }
  }
  if (input.description !== undefined) {
    const description = assertOptionalLength(input.description, 'description', 262144) ?? '';
    if (description !== current.description) {
      fields.description = description;
      changes.push({ field: 'description', from: current.description, to: description });
    }
  }
  if (input.priority !== undefined) {
    const priority = assertPriority(input.priority);
    if (priority !== current.priority) {
      fields.priority = priority;
      changes.push({ field: 'priority', from: current.priority, to: priority });
    }
  }
  if (input.assignee !== undefined) {
    const nextAssignee = input.assignee ? requireActorRow(db, input.assignee) : null;
    if ((nextAssignee?.id ?? null) !== current.assignee_id) {
      fields.assignee_id = nextAssignee?.id ?? null;
      changes.push({
        field: 'assignee',
        from: current.assignee_id ? getActorRef(db, current.assignee_id)?.name ?? null : null,
        to: nextAssignee?.name ?? null,
      });
    }
  }
  if (input.module !== undefined) {
    const nextModule = input.module
      ? findModuleRow(db, current.project_id, input.module)
      : null;
    if (input.module && !nextModule) {
      throw new DomainError('module_not_found', `Module not found: ${input.module}`);
    }
    if ((nextModule?.id ?? null) !== current.module_id) {
      fields.module_id = nextModule?.id ?? null;
      changes.push({
        field: 'module',
        from: current.module_id ? findModuleById(db, current.module_id)?.slug ?? null : null,
        to: nextModule?.slug ?? null,
      });
    }
  }
  if (input.parent !== undefined) {
    const nextParent = input.parent ? assertParentForIssue(db, current, input.parent) : null;
    if ((nextParent?.id ?? null) !== current.parent_id) {
      fields.parent_id = nextParent?.id ?? null;
      changes.push({
        field: 'parent',
        from: current.parent_id ? findIssueById(db, current.parent_id)?.key ?? null : null,
        to: nextParent?.key ?? null,
      });
    }
  }

  if (changes.length === 0) {
    return { changed: false, issue: issueRowToDetail(db, current) };
  }

  const now = nowIso();
  const nextRev = current.rev + 1;
  withImmediateTransaction(db, () => {
    const updated = updateIssueRow(
      db,
      current.id,
      { ...fields, rev: nextRev, updated_at: now },
      current.rev,
    );
    if (updated === 0) {
      const fresh = findIssueById(db, current.id);
      if (fresh) {
        conflict(`Issue changed since revision ${input.expected_rev}`, issueRowToDetail(db, fresh));
      }
      throw new DomainError('not_found', `Issue not found: ${input.issue}`);
    }
    recordActivity(db, {
      project_id: current.project_id,
      issue_id: current.id,
      actor,
      type: 'issue.updated',
      changes,
    });
  });

  return { changed: true, issue: issueRowToDetail(db, requireIssueRow(db, current.id)) };
}

export interface MoveIssueInput {
  issue: string;
  expected_rev: number;
  stage: string;
  position?: number;
  actor: string;
}

export function moveIssue(db: Database, input: MoveIssueInput): ChangeResult {
  const current = requireIssueRow(db, input.issue);
  const actor = requireActorRow(db, input.actor);
  assertExpectedRev(input.expected_rev);
  if (current.rev !== input.expected_rev) {
    conflict(`Issue changed since revision ${input.expected_rev}`, issueRowToDetail(db, current));
  }
  const stage = assertStage(input.stage);
  if (input.position !== undefined) assertFiniteNumber(input.position, 'position');
  if (current.stage === stage && input.position === undefined) {
    return { changed: false, issue: issueRowToDetail(db, current) };
  }

  const now = nowIso();
  const position = input.position ?? nextPosition(db, current.project_id, stage);
  const completedAt = stage === 'done' ? now : null;
  const cancelledAt = stage === 'cancelled' ? now : null;
  const nextRev = current.rev + 1;
  const changes: ActivityChange[] = [];
  if (current.stage !== stage) {
    changes.push({ field: 'stage', from: current.stage, to: stage });
  }
  if (current.position !== position) {
    changes.push({ field: 'position', from: current.position, to: position });
  }

  withImmediateTransaction(db, () => {
    updateIssueRow(
      db,
      current.id,
      {
        stage,
        position,
        completed_at: completedAt,
        cancelled_at: cancelledAt,
        rev: nextRev,
        updated_at: now,
      },
      current.rev,
    );
    recordActivity(db, {
      project_id: current.project_id,
      issue_id: current.id,
      actor,
      type: 'issue.moved',
      changes,
    });
  });

  return { changed: true, issue: issueRowToDetail(db, requireIssueRow(db, current.id)) };
}

export interface ClaimIssueInput {
  issue: string;
  expected_rev?: number;
  actor: string;
}

export interface ClaimIssueResult {
  claimed: boolean;
  already_owned?: boolean;
  issue: IssueDetail;
}

export function claimIssue(db: Database, input: ClaimIssueInput): ClaimIssueResult {
  const current = requireIssueRow(db, input.issue);
  const actor = requireActorRow(db, input.actor);
  if (input.expected_rev !== undefined) {
    assertExpectedRev(input.expected_rev);
    if (current.rev !== input.expected_rev) {
      conflict(`Issue changed since revision ${input.expected_rev}`, issueRowToDetail(db, current));
    }
  }
  if (current.stage === 'done' || current.stage === 'cancelled') {
    throw new DomainError('invalid_state', 'Cannot claim a done or cancelled Issue');
  }
  if (current.assignee_id === actor.id) {
    return {
      claimed: false,
      already_owned: true,
      issue: issueRowToDetail(db, current),
    };
  }
  if (current.assignee_id) {
    throw new DomainError('claim_conflict', 'Issue is already assigned', {
      currentIssue: issueRowToDetail(db, current),
    });
  }

  const now = nowIso();
  const nextStage = current.stage === 'backlog' || current.stage === 'todo'
    ? 'in_progress'
    : current.stage;
  const nextRev = current.rev + 1;
  withImmediateTransaction(db, () => {
    const result = db
      .prepare(
        `UPDATE issues
         SET assignee_id = ?, stage = CASE WHEN stage IN ('backlog', 'todo')
           THEN 'in_progress' ELSE stage END,
           rev = rev + 1, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL
           AND stage NOT IN ('done', 'cancelled')
           AND (assignee_id IS NULL OR assignee_id = ?)
           ${input.expected_rev === undefined ? '' : 'AND rev = ?'}`,
      )
      .run(
        actor.id,
        now,
        current.id,
        actor.id,
        ...(input.expected_rev === undefined ? [] : [input.expected_rev]),
      );
    if (Number(result.changes) === 0) {
      const fresh = findIssueById(db, current.id);
      if (!fresh) throw new DomainError('not_found', `Issue not found: ${input.issue}`);
      if (fresh.assignee_id === actor.id) return;
      if (fresh.assignee_id) {
        throw new DomainError('claim_conflict', 'Issue is already assigned', {
          currentIssue: issueRowToDetail(db, fresh),
        });
      }
      throw new DomainError('invalid_state', 'Issue cannot be claimed');
    }
    recordActivity(db, {
      project_id: current.project_id,
      issue_id: current.id,
      actor,
      type: 'issue.claimed',
      changes: [
        { field: 'assignee', from: null, to: actor.name },
        { field: 'stage', from: current.stage, to: nextStage },
      ],
    });
    // Keep the revision math visible for the no-op path.
    void nextRev;
  });

  return {
    claimed: true,
    issue: issueRowToDetail(db, requireIssueRow(db, current.id)),
  };
}

export interface ReleaseIssueInput {
  issue: string;
  actor: string;
}

export interface ReleaseIssueResult {
  released: boolean;
  issue: IssueDetail;
}

export function releaseIssue(db: Database, input: ReleaseIssueInput): ReleaseIssueResult {
  const current = requireIssueRow(db, input.issue);
  const actor = requireActorRow(db, input.actor);
  if (!current.assignee_id) {
    return { released: false, issue: issueRowToDetail(db, current) };
  }
  if (current.assignee_id !== actor.id && actor.kind !== 'human') {
    throw new DomainError('release_conflict', 'Only the Assignee or a human Actor may release');
  }
  const now = nowIso();
  const previousAssignee = getActorRef(db, current.assignee_id)?.name ?? null;
  withImmediateTransaction(db, () => {
    updateIssueRow(
      db,
      current.id,
      { assignee_id: null, rev: current.rev + 1, updated_at: now },
      current.rev,
    );
    recordActivity(db, {
      project_id: current.project_id,
      issue_id: current.id,
      actor,
      type: 'issue.released',
      changes: [{ field: 'assignee', from: previousAssignee, to: null }],
    });
  });
  return {
    released: true,
    issue: issueRowToDetail(db, requireIssueRow(db, current.id)),
  };
}

export interface BlockIssueInput {
  issue: string;
  expected_rev: number;
  reason: string;
  actor: string;
}

export function blockIssue(db: Database, input: BlockIssueInput): ChangeResult {
  const current = requireIssueRow(db, input.issue);
  const actor = requireActorRow(db, input.actor);
  assertExpectedRev(input.expected_rev);
  if (current.rev !== input.expected_rev) {
    conflict(`Issue changed since revision ${input.expected_rev}`, issueRowToDetail(db, current));
  }
  const reason = assertNonEmpty(input.reason, 'blocked reason', 2000);
  if (current.blocked === 1 && current.blocked_reason === reason) {
    return { changed: false, issue: issueRowToDetail(db, current) };
  }
  const now = nowIso();
  withImmediateTransaction(db, () => {
    updateIssueRow(
      db,
      current.id,
      {
        blocked: 1,
        blocked_reason: reason,
        blocked_at: now,
        blocked_by: actor.id,
        rev: current.rev + 1,
        updated_at: now,
      },
      current.rev,
    );
    recordActivity(db, {
      project_id: current.project_id,
      issue_id: current.id,
      actor,
      type: 'issue.blocked',
      changes: [
        { field: 'blocked', from: current.blocked === 1, to: true },
        { field: 'blocked_reason', from: current.blocked_reason, to: reason },
      ],
    });
  });
  return { changed: true, issue: issueRowToDetail(db, requireIssueRow(db, current.id)) };
}

export interface UnblockIssueInput {
  issue: string;
  expected_rev: number;
  actor: string;
}

export function unblockIssue(db: Database, input: UnblockIssueInput): ChangeResult {
  const current = requireIssueRow(db, input.issue);
  const actor = requireActorRow(db, input.actor);
  assertExpectedRev(input.expected_rev);
  if (current.rev !== input.expected_rev) {
    conflict(`Issue changed since revision ${input.expected_rev}`, issueRowToDetail(db, current));
  }
  if (current.blocked === 0) {
    return { changed: false, issue: issueRowToDetail(db, current) };
  }
  const now = nowIso();
  withImmediateTransaction(db, () => {
    updateIssueRow(
      db,
      current.id,
      {
        blocked: 0,
        blocked_reason: null,
        blocked_at: null,
        blocked_by: null,
        rev: current.rev + 1,
        updated_at: now,
      },
      current.rev,
    );
    recordActivity(db, {
      project_id: current.project_id,
      issue_id: current.id,
      actor,
      type: 'issue.unblocked',
      changes: [{ field: 'blocked', from: true, to: false }],
    });
  });
  return { changed: true, issue: issueRowToDetail(db, requireIssueRow(db, current.id)) };
}

export interface DeleteIssueInput {
  issue: string;
  expected_rev: number;
  cascade?: boolean;
  reason?: string;
  actor: string;
}

export interface DeleteIssueResult {
  deleted: IssueRef[];
  batch: string;
}

export function deleteIssue(db: Database, input: DeleteIssueInput): DeleteIssueResult {
  const current = requireIssueRow(db, input.issue);
  const actor = requireActorRow(db, input.actor);
  assertExpectedRev(input.expected_rev);
  if (current.rev !== input.expected_rev) {
    conflict(`Issue changed since revision ${input.expected_rev}`, issueRowToDetail(db, current));
  }
  const childCount = countActiveChildren(db, current.id);
  if (childCount > 0 && !input.cascade) {
    throw new DomainError('has_children', 'Issue has children; pass cascade to delete the subtree', {
      details: { children: childCount },
    });
  }

  const now = nowIso();
  const batch = newBatchId();
  let rows: { id: string; key: string; title: string; parent_id: string | null }[] = [];
  withImmediateTransaction(db, () => {
    rows = listSubtreeRows(db, current.id, input.cascade === true);
    if (rows.length === 0) {
      throw new DomainError('not_found', `Issue not found: ${input.issue}`);
    }
    softDeleteRows(
      db,
      rows.map((row) => row.id),
      actor.id,
      batch,
      now,
    );
    for (const row of rows) {
      recordActivity(db, {
        project_id: current.project_id,
        issue_id: row.id,
        actor,
        type: 'issue.deleted',
        changes: [
          { field: 'batch', to: batch },
          { field: 'reason', to: input.reason ?? null },
        ],
      });
    }
  });

  return { deleted: rows.map(({ id, key, title }) => ({ id, key, title })), batch };
}

export interface RestoreIssueInput {
  issue: string;
  actor: string;
}

export interface RestoreIssueResult {
  restored: IssueRef[];
  batch: string;
}

export function restoreIssue(db: Database, input: RestoreIssueInput): RestoreIssueResult {
  const current = findIssueRow(db, input.issue, true);
  if (!current) {
    throw new DomainError('not_found', `Issue not found: ${input.issue}`);
  }
  if (!current.deleted_at || !current.deletion_batch) {
    throw new DomainError('invalid_state', 'Issue is not deleted');
  }
  if (current.parent_id) {
    const parent = findIssueById(db, current.parent_id);
    if (parent?.deleted_at && parent.deletion_batch !== current.deletion_batch) {
      throw new DomainError('parent_deleted', 'Parent is deleted in a different batch');
    }
  }
  const actor = requireActorRow(db, input.actor);
  const batch = current.deletion_batch;
  const now = nowIso();
  let rows: { id: string; key: string; title: string; parent_id: string | null }[] = [];
  withImmediateTransaction(db, () => {
    rows = rowsForBatch(db, batch);
    restoreRows(db, batch, now);
    for (const row of rows) {
      recordActivity(db, {
        project_id: current.project_id,
        issue_id: row.id,
        actor,
        type: 'issue.restored',
        changes: [{ field: 'batch', from: batch, to: null }],
      });
    }
  });
  return { restored: rows.map(({ id, key, title }) => ({ id, key, title })), batch };
}

export function getIssue(
  db: Database,
  ref: string,
  options: IssueDetailOptions = {},
): IssueDetail {
  return issueRowToDetail(db, requireIssueRow(db, ref), options);
}

function priorityRank(priority: string): number {
  switch (priority) {
    case 'urgent':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 0;
  }
}

function encodeCursor(row: IssueRow, sort: 'updated' | 'priority' | 'position'): string {
  const payload: IssueCursor =
    sort === 'updated'
      ? { sort, updated_at: row.updated_at, id: row.id }
      : sort === 'position'
        ? { sort, position: row.position, id: row.id }
        : {
            sort,
            priority_rank: priorityRank(row.priority),
            updated_at: row.updated_at,
            id: row.id,
          };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined, sort: 'updated' | 'priority' | 'position'): IssueCursor | null {
  if (!cursor) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<IssueCursor>;
    if (payload.sort !== sort || !payload.id) {
      throw new Error('cursor does not match sort');
    }
    return payload as IssueCursor;
  } catch {
    throw new DomainError('cursor_invalid', 'Invalid pagination cursor');
  }
}

function sanitizeFtsQuery(query: string | undefined): string | undefined {
  if (!query) return undefined;
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return undefined;
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' ');
}

export interface ListIssuesInput {
  project: string;
  q?: string;
  stages?: string[];
  priorities?: string[];
  assignee?: string;
  module?: string;
  parent?: string;
  blocked?: boolean;
  has_attachments?: boolean;
  updated_since?: string;
  include_deleted?: boolean;
  limit?: number;
  cursor?: string;
  view?: 'compact' | 'full';
  sort?: 'updated' | 'priority' | 'position';
}

export interface ListIssuesResult {
  items: (IssueCard | IssueDetail)[];
  next_cursor: string | null;
  total: number;
}

export function listIssues(db: Database, input: ListIssuesInput): ListIssuesResult {
  const project = findProjectRow(db, input.project);
  if (!project) {
    throw new DomainError('not_found', `Project not found: ${input.project}`);
  }
  const sort = input.sort ?? 'updated';
  if (!['updated', 'priority', 'position'].includes(sort)) {
    throw new DomainError('validation_error', `Unknown sort: ${sort}`);
  }
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const stages = (input.stages ?? []).map(assertStage);
  const priorities = (input.priorities ?? []).map(assertPriority);

  let assigneeId: string | undefined;
  if (input.assignee) {
    const assignee = findActorRow(db, input.assignee);
    if (!assignee) return { items: [], next_cursor: null, total: 0 };
    assigneeId = assignee.id;
  }
  let moduleId: string | undefined;
  if (input.module) {
    const module = findModuleRow(db, project.id, input.module);
    if (!module) return { items: [], next_cursor: null, total: 0 };
    moduleId = module.id;
  }
  let parentId: string | undefined;
  if (input.parent) {
    const parent = findIssueRow(db, input.parent, true);
    if (!parent) return { items: [], next_cursor: null, total: 0 };
    parentId = parent.id;
  }

  const query: IssueQuery = {
    projectId: project.id,
    q: sanitizeFtsQuery(input.q),
    stages,
    priorities,
    assigneeId,
    moduleId,
    parentId,
    blocked: input.blocked,
    hasAttachments: input.has_attachments,
    updatedSince: input.updated_since,
    includeDeleted: input.include_deleted ?? false,
    limit: limit + 1,
    cursor: decodeCursor(input.cursor, sort),
    sort,
  };

  const rows = listIssueRows(db, query);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = page.map((row) =>
    input.view === 'full' ? issueRowToDetail(db, row) : issueRowToCard(db, row),
  );
  return {
    items,
    next_cursor: hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]!, sort) : null,
    total: countIssueRows(db, { ...query, cursor: null }),
  };
}

export interface BoardInput extends Omit<ListIssuesInput, 'stages' | 'limit' | 'cursor' | 'view'> {
  include_closed?: boolean;
}

export interface BoardColumn {
  stage: Stage;
  count: number;
  has_more: boolean;
  issues: IssueCard[];
}

export interface BoardResult {
  project: ReturnType<typeof projectRowToSummary>;
  columns: BoardColumn[];
  filtered_count: number;
}

export function getBoard(db: Database, input: BoardInput): BoardResult {
  const project = findProjectRow(db, input.project);
  if (!project) {
    throw new DomainError('not_found', `Project not found: ${input.project}`);
  }
  const base: Omit<IssueQuery, 'stages' | 'limit' | 'cursor'> = {
    projectId: project.id,
    q: sanitizeFtsQuery(input.q),
    priorities: (input.priorities ?? []).map(assertPriority),
    blocked: input.blocked,
    hasAttachments: input.has_attachments,
    updatedSince: input.updated_since,
    includeDeleted: input.include_deleted ?? false,
    sort: 'position',
  };
  if (input.assignee) {
    const assignee = findActorRow(db, input.assignee);
    if (assignee) base.assigneeId = assignee.id;
  }
  if (input.module) {
    const module = findModuleRow(db, project.id, input.module);
    if (module) base.moduleId = module.id;
  }
  if (input.parent) {
    const parent = findIssueRow(db, input.parent, true);
    if (parent) base.parentId = parent.id;
  }

  const stages = input.include_closed === false
    ? STAGES.filter((stage) => stage !== 'done' && stage !== 'cancelled')
    : [...STAGES];
  const columns = stages.map((stage) => {
    const query: IssueQuery = { ...base, stages: [stage], limit: 500 };
    const rows = listIssueRows(db, query);
    return {
      stage,
      count: countIssueRows(db, query),
      has_more: rows.length === 500,
      issues: rows.map((row) => issueRowToCard(db, row)),
    };
  });

  return {
    project: projectRowToSummary(db, project),
    columns,
    filtered_count: countIssueRows(db, { ...base, limit: 1 }),
  };
}

export function getActorRowForInput(db: Database, ref: string): ActorRow {
  return requireActorRow(db, ref);
}

export interface IssueSearchResult {
  project: { id: string; key: string; name: string };
  issue: IssueCard;
}

export function searchIssues(
  db: Database,
  query: string,
  limit = 20,
): IssueSearchResult[] {
  const sanitized = sanitizeFtsQuery(query);
  if (!sanitized) return [];
  const rows = db
    .prepare(
      `SELECT i.*
       FROM issues_fts f
       JOIN issues i ON i.rowid = f.rowid
       WHERE issues_fts MATCH ? AND i.deleted_at IS NULL
       ORDER BY bm25(issues_fts), i.updated_at DESC
       LIMIT ?`,
    )
    .all(sanitized, Math.min(Math.max(limit, 1), 100)) as unknown as IssueRow[];
  return rows.flatMap((row) => {
    const project = findProjectRow(db, row.project_id);
    if (!project) return [];
    return [
      {
        project: { id: project.id, key: project.key, name: project.name },
        issue: issueRowToCard(db, row),
      },
    ];
  });
}
