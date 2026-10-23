import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, ApiError } from '../api/client.js';
import { queryKeys, useActors, useBoard, useModules, useProjects } from '../api/queries.js';
import { useProjectEvents, type SseStatus } from '../api/sse.js';
import type { BoardResult, IssueCard, IssueDetail, Stage } from '../api/types.js';
import Board from '../components/board/Board.js';
import BoardSkeleton from '../components/board/BoardSkeleton.js';
import CreateIssueModal from '../components/board/CreateIssueModal.js';
import FilterBar from '../components/board/FilterBar.js';
import { EmptyState, ErrorState, FullPageSpinner } from '../components/common/Feedback.js';
import { useToast } from '../components/common/Toast.js';
import IssueDrawer from '../components/issue/IssueDrawer.js';
import {
  activeFilterCount,
  filtersToSearchParams,
  parseFilters,
} from '../lib/filters.js';
import { moveIssueInBoard } from '../lib/board.js';
import { useCollapsedColumns } from '../state/local.js';

function SseIndicator({ status }: { status: SseStatus }) {
  const color =
    status === 'open'
      ? 'bg-[var(--success)]'
      : status === 'connecting'
        ? 'bg-[var(--warning)]'
        : 'bg-[var(--danger)]';
  const label = status === 'open' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline';
  return (
    <span className="flex items-center gap-1.5 text-[10px] muted" title={`Live updates: ${status}`}>
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

export default function BoardRoute() {
  const { projectKey = '', issueKey } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const projectsQuery = useProjects();
  const modulesQuery = useModules(projectKey || undefined);
  const actorsQuery = useActors();
  const boardQuery = useBoard(projectKey || undefined, filters);
  const sseStatus = useProjectEvents(projectKey || undefined);
  const { collapsed, toggle } = useCollapsedColumns(projectKey);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStage, setCreateStage] = useState<Stage | undefined>(undefined);
  const newIssueRequested = Boolean(
    (location.state as { newIssue?: boolean } | null)?.newIssue,
  );
  const createModalOpen = createOpen || newIssueRequested;

  const project =
    boardQuery.data?.project ?? projectsQuery.data?.find((entry) => entry.key === projectKey);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'n' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      event.preventDefault();
      setCreateStage(undefined);
      setCreateOpen(true);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function updateFilters(next: typeof filters) {
    setSearchParams(filtersToSearchParams(next), { replace: true });
  }

  function openCreate(stage?: Stage) {
    setCreateStage(stage);
    setCreateOpen(true);
  }

  function handleCreateOpenChange(open: boolean) {
    setCreateOpen(open);
    if (!open && newIssueRequested) {
      navigate(`${location.pathname}${location.search}`, {
        replace: true,
        state: null,
      });
    }
  }

  async function handleMove(issue: IssueCard, stage: Stage, position: number) {
    const key = queryKeys.board(projectKey, filters);
    const previous = queryClient.getQueryData<BoardResult>(key);
    if (previous) {
      queryClient.setQueryData(key, moveIssueInBoard(previous, issue, stage, position));
    }
    try {
      await api.moveIssue(issue.key, {
        expected_rev: issue.rev,
        stage,
        position,
      });
      await queryClient.invalidateQueries({ queryKey: ['board', projectKey] });
    } catch (cause) {
      if (previous) queryClient.setQueryData(key, previous);
      const message =
        cause instanceof ApiError && cause.status === 409
          ? 'Issue changed while you were moving it. The board was refreshed.'
          : cause instanceof ApiError
            ? cause.message
            : String(cause);
      toast.push(message, 'error');
      await queryClient.invalidateQueries({ queryKey: ['board', projectKey] });
    }
  }

  function handleCreated(issue: IssueDetail) {
    setCreateOpen(false);
    void queryClient.invalidateQueries({ queryKey: ['board', projectKey] });
    navigate(`/projects/${projectKey}/issues/${issue.key}`);
  }

  if (projectsQuery.isLoading) return <FullPageSpinner />;
  if (projectsQuery.isError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <ErrorState
          title="Cannot load Projects"
          message={projectsQuery.error.message}
          onRetry={() => void projectsQuery.refetch()}
        />
      </div>
    );
  }
  if (!project && !boardQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <ErrorState
          title="Project not found"
          message={`No Project with key ${projectKey}.`}
          onRetry={() => navigate('/')}
        />
      </div>
    );
  }

  const empty =
    (boardQuery.data?.project.counts.total ?? project?.counts.total ?? 0) === 0 &&
    activeFilterCount(filters) === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-subtle px-4 py-3 surface">
        <div className="flex min-w-0 items-center gap-2">
          <span className="chip font-mono">{projectKey}</span>
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {project?.name ?? projectKey}
          </h1>
          <span className="text-[11px] muted">
            {boardQuery.data?.filtered_count ?? project?.counts.total ?? 0} Issues
          </span>
          {project?.counts.blocked ? (
            <span className="chip priority-urgent">{project.counts.blocked} blocked</span>
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <SseIndicator status={sseStatus} />
          <button type="button" className="btn btn-primary" onClick={() => openCreate()}>
            <Plus size={15} />
            New Issue
          </button>
        </div>
      </header>

      <FilterBar
        projectKey={projectKey}
        filters={filters}
        onChange={updateFilters}
        modules={modulesQuery.data ?? []}
        actors={actorsQuery.data ?? []}
      />

      {boardQuery.isLoading ? (
        <BoardSkeleton />
      ) : boardQuery.isError ? (
        <div className="flex flex-1 items-center justify-center">
          <ErrorState
            title="Cannot load the board"
            message={boardQuery.error.message}
            onRetry={() => void boardQuery.refetch()}
          />
        </div>
      ) : boardQuery.data ? (
        <>
          {empty ? (
            <div className="border-b border-subtle px-4 py-2">
              <EmptyState
                title="No Issues yet"
                description="Create the first Issue, or press n anywhere on the board."
                action={
                  <button type="button" className="btn btn-primary mt-1" onClick={() => openCreate()}>
                    <Plus size={14} />
                    New Issue
                  </button>
                }
              />
            </div>
          ) : null}
          <Board
            board={boardQuery.data}
            projectKey={projectKey}
            filters={filters}
            collapsed={collapsed}
            onToggleCollapse={toggle}
            onMove={(issue, stage, position) => void handleMove(issue, stage, position)}
            onNewIssue={openCreate}
          />
        </>
      ) : null}

      <CreateIssueModal
        open={createModalOpen}
        onOpenChange={handleCreateOpenChange}
        projectKey={projectKey}
        defaultStage={createStage}
        modules={modulesQuery.data ?? []}
        actors={actorsQuery.data ?? []}
        onCreated={handleCreated}
      />

      {issueKey ? (
        <IssueDrawer
          issueKey={issueKey}
          onClose={() => navigate(`/projects/${projectKey}/board`)}
        />
      ) : null}
    </div>
  );
}
