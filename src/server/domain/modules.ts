import type { Database } from '../db/connection.js';
import {
  countModuleIssues,
  deleteModuleRow,
  findModuleById,
  findModuleRow,
  insertModuleRow,
  listModuleRows,
  updateModuleRow,
} from '../db/repositories/modules.js';
import { findProjectRow } from '../db/repositories/projects.js';
import type { ModuleRow } from '../db/repositories/rows.js';
import { DomainError } from './errors.js';
import { newId } from './ids.js';
import { nowIso } from './time.js';
import type { Module } from './types.js';
import { assertNonEmpty, slugify } from './validation.js';

export function moduleRowToModule(row: ModuleRow): Module {
  return { id: row.id, name: row.name, slug: row.slug, color: row.color };
}

export function requireModuleRow(
  db: Database,
  projectId: string,
  ref: string,
): ModuleRow {
  const row = findModuleRow(db, projectId, ref);
  if (!row) {
    throw new DomainError('module_not_found', `Module not found: ${ref}`);
  }
  return row;
}

export interface CreateModuleInput {
  project: string;
  name: string;
  color?: string | null;
}

export interface CreateModuleResult {
  created: boolean;
  module: Module;
}

export function createModule(db: Database, input: CreateModuleInput): CreateModuleResult {
  const project = findProjectRow(db, input.project);
  if (!project) {
    throw new DomainError('not_found', `Project not found: ${input.project}`);
  }
  const name = assertNonEmpty(input.name, 'module name', 64);
  const slug = slugify(name);
  const existing = findModuleRow(db, project.id, slug);
  if (existing) {
    return { created: false, module: moduleRowToModule(existing) };
  }

  const row: ModuleRow = {
    id: newId(),
    project_id: project.id,
    name,
    slug,
    color: input.color ?? null,
    created_at: nowIso(),
  };
  insertModuleRow(db, row);
  return { created: true, module: moduleRowToModule(row) };
}

export function listModules(db: Database, projectRef: string): Module[] {
  const project = findProjectRow(db, projectRef);
  if (!project) {
    throw new DomainError('not_found', `Project not found: ${projectRef}`);
  }
  return listModuleRows(db, project.id).map(moduleRowToModule);
}

export interface UpdateModuleInput {
  name?: string;
  color?: string | null;
}

export function updateModule(db: Database, id: string, input: UpdateModuleInput): Module {
  const existing = findModuleById(db, id);
  if (!existing) {
    throw new DomainError('module_not_found', `Module not found: ${id}`);
  }
  const fields: { name?: string; color?: string | null } = {};
  if (input.name !== undefined) {
    fields.name = assertNonEmpty(input.name, 'module name', 64);
  }
  if (input.color !== undefined) {
    fields.color = input.color;
  }
  updateModuleRow(db, existing.id, fields);
  return moduleRowToModule(findModuleById(db, existing.id) ?? existing);
}

export function deleteModule(db: Database, id: string): void {
  const existing = findModuleById(db, id);
  if (!existing) {
    throw new DomainError('module_not_found', `Module not found: ${id}`);
  }
  if (countModuleIssues(db, id) > 0) {
    throw new DomainError('module_in_use', 'Module is used by active Issues');
  }
  deleteModuleRow(db, id);
}
