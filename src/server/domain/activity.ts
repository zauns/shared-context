import type { Database } from '../db/connection.js';
import {
  currentActivityCursor,
  insertActivityRow,
  listIssueActivityRows,
  listProjectActivityRows,
} from '../db/repositories/activities.js';
import type { ActorRow, ActivityRow } from '../db/repositories/rows.js';
import { getActorRef } from './actors.js';
import type { ActivityChange, ActivityEvent } from './types.js';
import { parseJsonArray } from './validation.js';
import { nowIso } from './time.js';

export interface RecordActivityInput {
  project_id: string;
  issue_id: string;
  actor: ActorRow;
  type: string;
  changes?: ActivityChange[];
  created_at?: string;
}

export function recordActivity(db: Database, input: RecordActivityInput): number {
  return insertActivityRow(db, {
    project_id: input.project_id,
    issue_id: input.issue_id,
    actor_id: input.actor.id,
    actor_name: input.actor.name,
    type: input.type,
    changes_json: JSON.stringify(input.changes ?? []),
    created_at: input.created_at ?? nowIso(),
  });
}

export function activityRowToEvent(db: Database, row: ActivityRow): ActivityEvent {
  const issue = db
    .prepare('SELECT key FROM issues WHERE id = ?')
    .get(row.issue_id) as unknown as { key: string } | undefined;
  return {
    id: row.id,
    type: row.type,
    project_id: row.project_id,
    issue_id: row.issue_id,
    issue_key: issue?.key ?? '',
    actor: row.actor_id ? getActorRef(db, row.actor_id) : null,
    actor_name: row.actor_name,
    at: row.created_at,
    changes: parseJsonArray<ActivityChange>(row.changes_json, 'activities.changes_json'),
  };
}

export function listIssueActivity(
  db: Database,
  issueId: string,
  limit = 50,
  beforeId?: number,
): ActivityEvent[] {
  return listIssueActivityRows(db, issueId, limit, beforeId).map((row) =>
    activityRowToEvent(db, row),
  );
}

export function listProjectActivity(
  db: Database,
  projectId: string,
  limit = 20,
  beforeId?: number,
): ActivityEvent[] {
  return listProjectActivityRows(db, projectId, limit, beforeId).map((row) =>
    activityRowToEvent(db, row),
  );
}

export { currentActivityCursor };
