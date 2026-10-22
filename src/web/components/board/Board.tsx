import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { BoardResult, IssueCard as IssueCardType, Stage } from '../../api/types.js';
import type { FilterState } from '../../lib/filters.js';
import { computeDropPosition, visibleStages } from '../../lib/board.js';
import BoardColumn from './BoardColumn.js';
import { IssueCardView } from './IssueCard.js';

export default function Board({
  board,
  projectKey,
  filters,
  collapsed,
  onToggleCollapse,
  onMove,
  onNewIssue,
}: {
  board: BoardResult;
  projectKey: string;
  filters: FilterState;
  collapsed: string[];
  onToggleCollapse: (stage: string) => void;
  onMove: (issue: IssueCardType, stage: Stage, position: number) => void;
  onNewIssue: (stage: Stage) => void;
}) {
  const [activeIssue, setActiveIssue] = useState<IssueCardType | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columns = visibleStages(filters.stages)
    .map((stage) => board.columns.find((column) => column.stage === stage))
    .filter((column): column is BoardResult['columns'][number] => Boolean(column));

  function handleDragStart(event: DragStartEvent) {
    const issue = event.active.data.current?.issue as IssueCardType | undefined;
    setActiveIssue(issue ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const issue = activeIssue;
    setActiveIssue(null);
    if (!issue || !event.over) return;
    if (event.over.id === event.active.id) return;

    const overData = event.over.data.current as
      | { type: 'column'; stage: Stage }
      | { type: 'card'; stage: Stage; issue: IssueCardType }
      | undefined;
    if (!overData) return;

    const targetStage = overData.stage;
    const targetColumn = board.columns.find((column) => column.stage === targetStage);
    if (!targetColumn) return;

    const targetIssues = targetColumn.issues.filter((entry) => entry.id !== issue.id);
    let overIndex = targetIssues.length;
    if (overData.type === 'card') {
      const found = targetIssues.findIndex((entry) => entry.id === event.over!.id);
      if (found >= 0) overIndex = found;
    }
    const position = computeDropPosition(targetIssues, overIndex);
    if (issue.stage === targetStage && Math.abs(issue.position - position) < 0.001) {
      return;
    }
    onMove(issue, targetStage, position);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveIssue(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="kanban-scroll scrollbar min-h-0 flex-1 items-start">
        {columns.map((column) => (
          <BoardColumn
            key={column.stage}
            column={column}
            projectKey={projectKey}
            collapsed={collapsed.includes(column.stage)}
            onToggleCollapse={() => onToggleCollapse(column.stage)}
            onNewIssue={() => onNewIssue(column.stage)}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeIssue ? (
          <IssueCardView issue={activeIssue} projectKey={projectKey} overlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
