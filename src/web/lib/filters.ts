import type { Priority, Stage } from '../api/types.js';

export interface FilterState {
  q: string;
  stages: Stage[];
  priorities: Priority[];
  assignee: string;
  module: string;
  blocked: boolean;
  hasAttachments: boolean;
  includeClosed: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  q: '',
  stages: [],
  priorities: [],
  assignee: '',
  module: '',
  blocked: false,
  hasAttachments: false,
  includeClosed: true,
};

const VALID_STAGES = new Set<string>([
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
]);
const VALID_PRIORITIES = new Set<string>(['urgent', 'high', 'medium', 'low', 'none']);

function csv(value: string | null): string[] {
  return value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : [];
}

export function parseFilters(params: URLSearchParams): FilterState {
  return {
    q: params.get('q') ?? '',
    stages: csv(params.get('stages')).filter((value): value is Stage =>
      VALID_STAGES.has(value),
    ),
    priorities: csv(params.get('priorities')).filter((value): value is Priority =>
      VALID_PRIORITIES.has(value),
    ),
    assignee: params.get('assignee') ?? '',
    module: params.get('module') ?? '',
    blocked: params.get('blocked') === '1',
    hasAttachments: params.get('attachments') === '1',
    includeClosed: params.get('closed') !== '0',
  };
}

export function filtersToSearchParams(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.stages.length > 0) params.set('stages', filters.stages.join(','));
  if (filters.priorities.length > 0) params.set('priorities', filters.priorities.join(','));
  if (filters.assignee) params.set('assignee', filters.assignee);
  if (filters.module) params.set('module', filters.module);
  if (filters.blocked) params.set('blocked', '1');
  if (filters.hasAttachments) params.set('attachments', '1');
  if (!filters.includeClosed) params.set('closed', '0');
  return params;
}

export function activeFilterCount(filters: FilterState): number {
  return (
    (filters.q.trim() ? 1 : 0) +
    filters.stages.length +
    filters.priorities.length +
    (filters.assignee ? 1 : 0) +
    (filters.module ? 1 : 0) +
    (filters.blocked ? 1 : 0) +
    (filters.hasAttachments ? 1 : 0) +
    (filters.includeClosed ? 0 : 1)
  );
}

export function sameFilters(a: FilterState, b: FilterState): boolean {
  return (
    a.q === b.q &&
    a.stages.join(',') === b.stages.join(',') &&
    a.priorities.join(',') === b.priorities.join(',') &&
    a.assignee === b.assignee &&
    a.module === b.module &&
    a.blocked === b.blocked &&
    a.hasAttachments === b.hasAttachments &&
    a.includeClosed === b.includeClosed
  );
}

/** Append a non-empty query string to an in-Project navigation path. */
export function withSearch(path: string, search: string | URLSearchParams): string {
  const query = (typeof search === 'string' ? search : search.toString()).replace(/^\?/, '');
  if (!query) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${query}`;
}
