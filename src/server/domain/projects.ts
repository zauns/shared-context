import fs from 'node:fs';
import type { Database } from '../db/connection.js';
import {
  countProjectIssues,
  deleteProjectRow,
  findProjectRow,
  insertProjectRow,
  listProjectRows,
  updateProjectRow,
} from '../db/repositories/projects.js';
import { listIssueRows } from '../db/repositories/issues.js';
import type { ProjectRow } from '../db/repositories/rows.js';
import { DomainError } from './errors.js';
import { newId } from './ids.js';
import { nowIso } from './time.js';
import type { ContextSnapshot, ProjectSummary } from './types.js';import { assertNonEmpty, assertProjectKey } from './validation.js';
import { DEFAULT_DOC_ALLOWLIST, listProjectDocs, readProjectDoc, validateDocAllowlist } from './docs.js';
import { listProjectActivity } from './activity.js';
import { issueRowToCard } from './issues.js';
import { projectDocAllowlist, projectRowToSummary } from './project-summary.js';

export interface CreateProjectInput {
  key: string;
  name: string;
  description?: string;
  root_path?: string | null;
  doc_allowlist?: string[];
}

export function createProject(db: Database, input: CreateProjectInput): ProjectSummary {
  const key = assertProjectKey(input.key);
  const name = assertNonEmpty(input.name, 'project name', 200);
  const description = input.description ?? '';
  if (description.length > 65536) {
    throw new DomainError('validation_error', 'Project description is too long');
  }
  if (input.root_path && !fs.existsSync(input.root_path)) {
    throw new DomainError('validation_error', `Project root does not exist: ${input.root_path}`);
  }
  const now = nowIso();
  const row: ProjectRow = {
    id: newId(),
    key,
    name,
    description,
    root_path: input.root_path ?? null,
    doc_allowlist_json: JSON.stringify(
      input.doc_allowlist ? validateDocAllowlist(input.doc_allowlist) : DEFAULT_DOC_ALLOWLIST,
    ),
    next_issue_number: 1,
    created_at: now,
    updated_at: now,
  };
  try {
    insertProjectRow(db, row);
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed')) {
      throw new DomainError('conflict', `Project key already exists: ${key}`);
    }
    throw error;
  }
  return projectRowToSummary(db, row);
}

export function listProjects(db: Database): ProjectSummary[] {
  return listProjectRows(db).map((row) => projectRowToSummary(db, row));
}

export function getProject(db: Database, ref: string): ProjectSummary {
  const row = findProjectRow(db, ref);
  if (!row) {
    throw new DomainError('not_found', `Project not found: ${ref}`);
  }
  return projectRowToSummary(db, row);
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  root_path?: string | null;
  doc_allowlist?: string[];
}

export function updateProject(
  db: Database,
  ref: string,
  input: UpdateProjectInput,
): ProjectSummary {
  const row = findProjectRow(db, ref);
  if (!row) {
    throw new DomainError('not_found', `Project not found: ${ref}`);
  }
  const fields: {
    name?: string;
    description?: string;
    root_path?: string | null;
    doc_allowlist_json?: string;
    updated_at: string;
  } = { updated_at: nowIso() };

  if (input.name !== undefined) {
    fields.name = assertNonEmpty(input.name, 'project name', 200);
  }
  if (input.description !== undefined) {
    if (input.description.length > 65536) {
      throw new DomainError('validation_error', 'Project description is too long');
    }
    fields.description = input.description;
  }
  if (input.root_path !== undefined) {
    if (input.root_path && !fs.existsSync(input.root_path)) {
      throw new DomainError('validation_error', `Project root does not exist: ${input.root_path}`);
    }
    fields.root_path = input.root_path;
  }
  if (input.doc_allowlist !== undefined) {
    fields.doc_allowlist_json = JSON.stringify(validateDocAllowlist(input.doc_allowlist));
  }

  updateProjectRow(db, row.id, fields);
  return projectRowToSummary(db, { ...row, ...fields });
}

export function deleteProject(db: Database, ref: string): void {
  const row = findProjectRow(db, ref);
  if (!row) {
    throw new DomainError('not_found', `Project not found: ${ref}`);
  }
  if (countProjectIssues(db, row.id) > 0) {
    throw new DomainError('project_not_empty', 'Project still contains Issues');
  }
  deleteProjectRow(db, row.id);
}

export function getProjectContext(
  db: Database,
  ref: string,
  actorId?: string,
): ContextSnapshot {
  const row = findProjectRow(db, ref);
  if (!row) {
    throw new DomainError('not_found', `Project not found: ${ref}`);
  }
  const project = projectRowToSummary(db, row);
  const allowlist = projectDocAllowlist(row);
  const blocked = listIssueRows(db, {
    projectId: row.id,
    blocked: true,
    limit: 20,
    sort: 'updated',
  }).map((issue) => issueRowToCard(db, issue));
  const mine = actorId
    ? listIssueRows(db, {
        projectId: row.id,
        assigneeId: actorId,
        stages: ['backlog', 'todo', 'in_progress', 'review'],
        limit: 20,
        sort: 'updated',
      }).map((issue) => issueRowToCard(db, issue))
    : [];

  return {
    project,
    counts: project.counts,
    modules: project.modules,
    blocked_issues: blocked,
    my_issues: mine,
    recent_changes: listProjectActivity(db, row.id, 20),
    docs: listProjectDocs(row.root_path, allowlist),
  };
}

export function readProjectDocument(
  db: Database,
  ref: string,
  requestedPath: string,
): ReturnType<typeof readProjectDoc> {
  const row = findProjectRow(db, ref);
  if (!row) {
    throw new DomainError('not_found', `Project not found: ${ref}`);
  }
  return readProjectDoc(row.root_path, projectDocAllowlist(row), requestedPath);
}
