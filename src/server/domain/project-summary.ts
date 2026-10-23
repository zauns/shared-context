import type { Database } from '../db/connection.js';
import { listModulesWithUsage } from './modules.js';
import { projectCounts } from '../db/repositories/projects.js';
import type { ProjectRow } from '../db/repositories/rows.js';
import type { ProjectSummary } from './types.js';
import { DEFAULT_DOC_ALLOWLIST } from './docs.js';
import { parseJsonArray } from './validation.js';

export function projectDocAllowlist(row: ProjectRow): string[] {
  try {
    const parsed = parseJsonArray<string>(row.doc_allowlist_json, 'projects.doc_allowlist_json');
    return parsed.length > 0 ? parsed : DEFAULT_DOC_ALLOWLIST;
  } catch {
    return DEFAULT_DOC_ALLOWLIST;
  }
}

export function projectRowToSummary(db: Database, row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    root_path: row.root_path,
    doc_allowlist: projectDocAllowlist(row),
    modules: listModulesWithUsage(db, row.id),
    counts: projectCounts(db, row.id),
    updated_at: row.updated_at,
  };
}
