import { formatDistanceToNowStrict } from 'date-fns';
import type { BoardResult, IssueCard, Priority, Stage } from '../api/types.js';
import { STAGES } from '../api/types.js';

export function computeDropPosition(issues: IssueCard[], overIndex: number): number {
  if (issues.length === 0) return 1024;
  if (overIndex <= 0) return issues[0]!.position - 1024;
  if (overIndex >= issues.length) return issues[issues.length - 1]!.position + 1024;
  const before = issues[overIndex - 1]!;
  const after = issues[overIndex]!;
  return (before.position + after.position) / 2;
}

export function moveIssueInBoard(
  board: BoardResult,
  issue: IssueCard,
  targetStage: Stage,
  position: number,
): BoardResult {
  const moved: IssueCard = { ...issue, stage: targetStage, position };
  const columns = board.columns.map((column) => {
    const issues = column.issues.filter((entry) => entry.id !== issue.id);
    if (column.stage === targetStage) {
      issues.push(moved);
      issues.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    }
    return { ...column, issues, count: issues.length };
  });
  return { ...board, columns };
}

export function visibleStages(filtersStages: Stage[]): Stage[] {
  return filtersStages.length > 0
    ? STAGES.filter((stage) => filtersStages.includes(stage))
    : [...STAGES];
}

export function stageLabel(stage: Stage): string {
  switch (stage) {
    case 'in_progress':
      return 'In Progress';
    default:
      return stage.charAt(0).toUpperCase() + stage.slice(1);
  }
}

export function stageAccent(stage: Stage): string {
  switch (stage) {
    case 'backlog':
      return '#94a3b8';
    case 'todo':
      return '#38bdf8';
    case 'in_progress':
      return '#22d3ee';
    case 'review':
      return '#a78bfa';
    case 'done':
      return '#34d399';
    case 'cancelled':
      return '#f87171';
  }
}

export function priorityLabel(priority: Priority): string {
  return priority === 'none' ? 'None' : priority.charAt(0).toUpperCase() + priority.slice(1);
}

export function priorityClass(priority: Priority): string {
  switch (priority) {
    case 'urgent':
      return 'priority-urgent';
    case 'high':
      return 'priority-high';
    case 'medium':
      return 'priority-medium';
    case 'low':
      return 'priority-low';
    default:
      return 'priority-none';
  }
}

export function priorityRank(priority: Priority): number {
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

export function relativeTime(value: string): string {
  try {
    return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
  } catch {
    return value;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function childProgressLabel(issue: IssueCard): string | null {
  const total = issue.child_progress.done + issue.child_progress.active;
  if (total === 0) return null;
  return `${issue.child_progress.done}/${total}`;
}

export function childProgressPercent(issue: IssueCard): number {
  const total = issue.child_progress.done + issue.child_progress.active;
  if (total === 0) return 0;
  return Math.round((issue.child_progress.done / total) * 100);
}
