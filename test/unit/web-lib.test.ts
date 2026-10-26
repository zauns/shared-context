import { describe, expect, it } from 'vitest';
import type { BoardResult, IssueCard } from '../../src/web/api/types.js';
import { STAGES } from '../../src/web/api/types.js';
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  filtersToSearchParams,
  parseFilters,
  withSearch,
} from '../../src/web/lib/filters.js';
import {
  computeDropPosition,
  moveIssueInBoard,
  visibleStages,
} from '../../src/web/lib/board.js';

function issue(overrides: Partial<IssueCard> = {}): IssueCard {
  return {
    id: 'issue-1',
    key: 'SHC-1',
    title: 'Issue',
    stage: 'backlog',
    priority: 'none',
    assignee: null,
    module: null,
    blocked: false,
    blocked_reason: null,
    attachment_count: 0,
    comment_count: 0,
    child_progress: { done: 0, active: 0, cancelled: 0, total: 0 },
    position: 1024,
    rev: 1,
    updated_at: '2026-10-22T00:00:00.000Z',
    ...overrides,
  };
}

function board(): BoardResult {
  return {
    ok: true,
    project: {
      id: 'project-1',
      key: 'SHC',
      name: 'Shared Context',
      description: '',
      root_path: null,
      modules: [],
      counts: {
        by_stage: { backlog: 1, todo: 0, in_progress: 0, review: 0, done: 0, cancelled: 0 },
        by_priority: { urgent: 0, high: 0, medium: 0, low: 0, none: 1 },
        blocked: 0,
        total: 1,
      },
      updated_at: '2026-10-22T00:00:00.000Z',
    },
    columns: STAGES.map((stage) => ({
      stage,
      count: stage === 'backlog' ? 1 : 0,
      has_more: false,
      issues: stage === 'backlog' ? [issue()] : [],
    })),
    filtered_count: 1,
  };
}

describe('filter serialization', () => {
  it('round-trips filters through URLSearchParams', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      q: 'login bug',
      stages: ['backlog' as const, 'review' as const],
      priorities: ['urgent' as const],
      assignee: 'frontend-agent',
      module: 'backend-fix',
      blocked: true,
      hasAttachments: true,
      includeClosed: false,
    };
    const params = filtersToSearchParams(filters);
    const parsed = parseFilters(params);
    expect(parsed).toEqual(filters);
    expect(activeFilterCount(parsed)).toBe(9);
  });

  it('treats missing closed as included', () => {
    const parsed = parseFilters(new URLSearchParams());
    expect(parsed.includeClosed).toBe(true);
    expect(activeFilterCount(parsed)).toBe(0);
  });
});

describe('withSearch', () => {
  it('returns the path unchanged for an empty search', () => {
    expect(withSearch('/projects/SHC/board', '')).toBe('/projects/SHC/board');
    expect(withSearch('/projects/SHC/board', '?')).toBe('/projects/SHC/board');
    expect(withSearch('/projects/SHC/board', new URLSearchParams())).toBe('/projects/SHC/board');
  });

  it('appends a non-empty query string', () => {
    expect(withSearch('/projects/SHC/issues/SHC-1', '?stages=todo&blocked=1')).toBe(
      '/projects/SHC/issues/SHC-1?stages=todo&blocked=1',
    );
  });

  it('accepts URLSearchParams input', () => {
    const params = new URLSearchParams({ q: 'login bug', closed: '0' });
    expect(withSearch('/projects/SHC/board', params)).toBe(
      '/projects/SHC/board?q=login+bug&closed=0',
    );
  });

  it('merges with an existing query on the path', () => {
    expect(withSearch('/projects/SHC/board?x=1', 'q=a')).toBe('/projects/SHC/board?x=1&q=a');
  });
});

describe('board utilities', () => {
  it('computes positions at the ends and between cards', () => {
    const issues = [
      issue({ id: 'a', position: 1024 }),
      issue({ id: 'b', position: 2048 }),
    ];
    expect(computeDropPosition(issues, 0)).toBe(0);
    expect(computeDropPosition(issues, 1)).toBe(1536);
    expect(computeDropPosition(issues, 2)).toBe(3072);
  });

  it('moves a card between columns and updates counts', () => {
    const original = board();
    const moved = moveIssueInBoard(original, original.columns[0]!.issues[0]!, 'todo', 1024);
    expect(moved.columns[0]!.issues).toHaveLength(0);
    expect(moved.columns[0]!.count).toBe(0);
    expect(moved.columns[1]!.issues).toHaveLength(1);
    expect(moved.columns[1]!.issues[0]!.stage).toBe('todo');
  });

  it('hides columns not selected by the stage filter', () => {
    expect(visibleStages([])).toHaveLength(6);
    expect(visibleStages(['todo', 'done'])).toEqual(['todo', 'done']);
  });
});
