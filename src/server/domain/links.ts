import type { Database } from '../db/connection.js';
import { withImmediateTransaction } from '../db/connection.js';
import {
  countLinkRows,
  deleteLinkRow,
  findLinkRow,
  insertLinkRow,
  listLinkRows,
} from '../db/repositories/links.js';
import type { LinkRow } from '../db/repositories/rows.js';
import { DomainError } from './errors.js';
import { newId } from './ids.js';
import { nowIso } from './time.js';
import { actorRowToRef, requireActorRow } from './actors.js';
import { recordActivity } from './activity.js';
import { requireIssueRow } from './issues.js';
import type { Link } from './types.js';
import { assertHttpUrl } from './validation.js';

export function linkRowToLink(db: Database, row: LinkRow): Link {
  return {
    id: row.id,
    url: row.url,
    label: row.label,
    created_by: actorRowToRef(requireActorRow(db, row.created_by)),
    created_at: row.created_at,
  };
}

export interface AddLinkInput {
  issue: string;
  url: string;
  label?: string | null;
  actor: string;
}

export function addLink(db: Database, input: AddLinkInput): Link {
  const issue = requireIssueRow(db, input.issue);
  const actor = requireActorRow(db, input.actor);
  const url = assertHttpUrl(input.url);
  if (input.label && input.label.length > 200) {
    throw new DomainError('validation_error', 'Link label is too long');
  }
  if (countLinkRows(db, issue.id) >= 50) {
    throw new DomainError('validation_error', 'An Issue may have at most 50 links');
  }
  const row: LinkRow = {
    id: newId(),
    issue_id: issue.id,
    url,
    label: input.label ?? null,
    created_by: actor.id,
    created_at: nowIso(),
  };
  withImmediateTransaction(db, () => {
    insertLinkRow(db, row);
    recordActivity(db, {
      project_id: issue.project_id,
      issue_id: issue.id,
      actor,
      type: 'link.added',
      changes: [{ field: 'link', to: { id: row.id, url: row.url, label: row.label } }],
    });
  });
  return linkRowToLink(db, row);
}

export interface RemoveLinkInput {
  issue: string;
  link_id: string;
  actor: string;
}

export function removeLink(db: Database, input: RemoveLinkInput): void {
  const issue = requireIssueRow(db, input.issue);
  const actor = requireActorRow(db, input.actor);
  const row = findLinkRow(db, input.link_id);
  if (!row || row.issue_id !== issue.id) {
    throw new DomainError('not_found', `Link not found: ${input.link_id}`);
  }
  withImmediateTransaction(db, () => {
    deleteLinkRow(db, row.id);
    recordActivity(db, {
      project_id: issue.project_id,
      issue_id: issue.id,
      actor,
      type: 'link.removed',
      changes: [{ field: 'link', from: { id: row.id, url: row.url, label: row.label }, to: null }],
    });
  });
}

export function listLinks(db: Database, issueRef: string): Link[] {
  const issue = requireIssueRow(db, issueRef);
  return listLinkRows(db, issue.id).map((row) => linkRowToLink(db, row));
}
