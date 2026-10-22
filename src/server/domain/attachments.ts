import type { Database } from '../db/connection.js';
import { withImmediateTransaction } from '../db/connection.js';
import {
  findActiveAttachmentBySha,
  findAttachmentRow,
  insertAttachmentRow,
  listAttachmentRows,
  softDeleteAttachmentRow,
} from '../db/repositories/attachments.js';
import type { AttachmentRow } from '../db/repositories/rows.js';
import { DomainError } from './errors.js';
import { newId } from './ids.js';
import { nowIso } from './time.js';
import { actorRowToRef, requireActorRow } from './actors.js';
import { recordActivity } from './activity.js';
import { requireIssueRow } from './issues.js';
import type { Attachment } from './types.js';

export function attachmentRowToAttachment(db: Database, row: AttachmentRow): Attachment {
  return {
    id: row.id,
    original_name: row.original_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    sha256: row.sha256,
    created_by: actorRowToRef(requireActorRow(db, row.created_by)),
    created_at: row.created_at,
    has_text: row.text_path !== null,
    is_image: row.mime_type.startsWith('image/'),
  };
}

export interface CreateAttachmentRecordInput {
  issue: string;
  original_name: string;
  stored_path: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  text_path?: string | null;
  actor: string;
}

export function createAttachmentRecord(
  db: Database,
  input: CreateAttachmentRecordInput,
): Attachment {
  const issue = requireIssueRow(db, input.issue);
  const actor = requireActorRow(db, input.actor);
  if (input.original_name.length === 0 || input.original_name.length > 255) {
    throw new DomainError('validation_error', 'Attachment filename must be 1–255 characters');
  }
  if (input.size_bytes <= 0 || input.size_bytes > 25 * 1024 * 1024) {
    throw new DomainError('attachment_too_large', 'Attachment exceeds the 25 MB limit');
  }
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) {
    throw new DomainError('validation_error', 'Attachment SHA-256 is invalid');
  }
  const existing = findActiveAttachmentBySha(db, issue.id, input.sha256);
  if (existing) {
    return { ...attachmentRowToAttachment(db, existing), id: existing.id };
  }
  const row: AttachmentRow = {
    id: newId(),
    issue_id: issue.id,
    original_name: input.original_name,
    stored_path: input.stored_path,
    mime_type: input.mime_type,
    size_bytes: input.size_bytes,
    sha256: input.sha256,
    text_path: input.text_path ?? null,
    created_by: actor.id,
    created_at: nowIso(),
    deleted_at: null,
  };
  withImmediateTransaction(db, () => {
    insertAttachmentRow(db, row);
    recordActivity(db, {
      project_id: issue.project_id,
      issue_id: issue.id,
      actor,
      type: 'attachment.added',
      changes: [{ field: 'attachment', to: { id: row.id, name: row.original_name } }],
    });
  });
  return attachmentRowToAttachment(db, row);
}

export interface RemoveAttachmentInput {
  issue: string;
  attachment_id: string;
  actor: string;
}

export function removeAttachment(db: Database, input: RemoveAttachmentInput): void {
  const issue = requireIssueRow(db, input.issue);
  const actor = requireActorRow(db, input.actor);
  const row = findAttachmentRow(db, input.attachment_id);
  if (!row || row.issue_id !== issue.id || row.deleted_at) {
    throw new DomainError('not_found', `Attachment not found: ${input.attachment_id}`);
  }
  withImmediateTransaction(db, () => {
    softDeleteAttachmentRow(db, row.id, nowIso());
    recordActivity(db, {
      project_id: issue.project_id,
      issue_id: issue.id,
      actor,
      type: 'attachment.removed',
      changes: [{ field: 'attachment', from: { id: row.id, name: row.original_name }, to: null }],
    });
  });
}

export function listAttachments(db: Database, issueRef: string): Attachment[] {
  const issue = requireIssueRow(db, issueRef);
  return listAttachmentRows(db, issue.id).map((row) => attachmentRowToAttachment(db, row));
}

export function getAttachment(db: Database, id: string): Attachment {
  const row = findAttachmentRow(db, id);
  if (!row || row.deleted_at) {
    throw new DomainError('not_found', `Attachment not found: ${id}`);
  }
  return attachmentRowToAttachment(db, row);
}
