import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { BoardColumn as BoardColumnType, Stage } from '../../api/types.js';
import { stageAccent, stageLabel } from '../../lib/board.js';
import { IssueCard } from './IssueCard.js';

export default function BoardColumn({
  column,
  projectKey,
  collapsed,
  onToggleCollapse,
  onNewIssue,
}: {
  column: BoardColumnType;
  projectKey: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNewIssue: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${column.stage}`,
    data: { type: 'column', stage: column.stage },
  });

  if (collapsed) {
    return (
      <section
        ref={setNodeRef}
        className={`column collapsed ${isOver ? 'is-over' : ''}`}
        onClick={onToggleCollapse}
        title={`Expand ${stageLabel(column.stage)}`}
      >
        <div className="flex h-full flex-col items-center gap-2 py-3">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: stageAccent(column.stage) }}
          />
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.16em] muted"
            style={{ writingMode: 'vertical-rl' }}
          >
            {stageLabel(column.stage)}
          </span>
          <span className="chip">{column.count}</span>
          <ChevronRight size={13} className="muted" />
        </div>
      </section>
    );
  }

  return (
    <section ref={setNodeRef} className={`column ${isOver ? 'is-over' : ''}`}>
      <header className="column-header">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: stageAccent(column.stage) }}
        />
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">
          {stageLabel(column.stage)}
        </h2>
        <span className="chip">{column.count}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={onNewIssue}
            aria-label={`New Issue in ${stageLabel(column.stage)}`}
            title="New Issue"
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={onToggleCollapse}
            aria-label={`Collapse ${stageLabel(column.stage)}`}
            title="Collapse"
          >
            <ChevronLeft size={14} />
          </button>
        </div>
      </header>

      <SortableContext
        items={column.issues.map((issue) => issue.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="column-body scrollbar">
          {column.issues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} projectKey={projectKey} />
          ))}
          {column.issues.length === 0 ? (
            <p className="px-1 py-3 text-center text-[11px] muted">
              No Issues
            </p>
          ) : null}
        </div>
      </SortableContext>
    </section>
  );
}

export function stageForColumn(column: BoardColumnType): Stage {
  return column.stage;
}
