import { Link, useLocation, useNavigate } from 'react-router';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import { Ban, GitBranch, MessageSquare, Paperclip } from 'lucide-react';
import type { IssueCard as IssueCardType } from '../../api/types.js';
import {
  childProgressLabel,
  childProgressPercent,
  priorityClass,
  priorityLabel,
  relativeTime,
} from '../../lib/board.js';
import { withSearch } from '../../lib/filters.js';

function Avatar({ name, color }: { name: string; color: string | null }) {
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-subtle text-[9px] font-semibold"
      style={{
        background: color ? `${color}22` : 'var(--accent-soft)',
        color: color ?? 'var(--accent)',
      }}
      title={name}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function IssueCardView({
  issue,
  projectKey,
  overlay = false,
  onOpen,
}: {
  issue: IssueCardType;
  projectKey: string;
  overlay?: boolean;
  onOpen?: () => void;
}) {
  const progress = childProgressLabel(issue);
  const percent = childProgressPercent(issue);
  const { search } = useLocation();
  const issuePath = withSearch(`/projects/${projectKey}/issues/${issue.key}`, search);

  return (
    <article
      className={`issue-card ${overlay ? 'is-overlay' : ''}`}
      data-issue-key={issue.key}
      onClick={(event) => {
        if (overlay) return;
        const target = event.target as HTMLElement;
        if (target.closest('a')) return;
        onOpen?.();
      }}
    >
      <div className="flex items-center gap-1.5">
        <Link
          to={issuePath}
          className="font-mono text-[10px] font-semibold muted hover:text-[var(--accent)]"
          onClick={(event) => event.stopPropagation()}
        >
          {issue.key}
        </Link>
        <span className={`chip ${priorityClass(issue.priority)}`}>
          {priorityLabel(issue.priority)}
        </span>
        {issue.blocked ? (
          <span className="chip priority-urgent" title={issue.blocked_reason ?? 'Blocked'}>
            <Ban size={10} />
            Blocked
          </span>
        ) : null}
        <span className="ml-auto whitespace-nowrap text-[10px] muted">
          {relativeTime(issue.updated_at)}
        </span>
      </div>

      <p className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-snug">{issue.title}</p>

      {issue.blocked && issue.blocked_reason ? (
        <p className="mt-1 line-clamp-1 text-[10px] text-[var(--danger)]">
          {issue.blocked_reason}
        </p>
      ) : null}

      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] muted">
        {issue.assignee ? (
          <span className="flex min-w-0 items-center gap-1">
            <Avatar name={issue.assignee.name} color={issue.assignee.color} />
            <span className="max-w-[90px] truncate">{issue.assignee.name}</span>
          </span>
        ) : (
          <span className="text-[10px] muted">Unassigned</span>
        )}

        {issue.module ? (
          <span className="max-w-[100px] truncate rounded-full border border-subtle px-1.5 py-0.5 text-[10px]">
            {issue.module.name}
          </span>
        ) : null}

        <span className="ml-auto flex items-center gap-1.5">
          {issue.attachment_count > 0 ? (
            <span className="flex items-center gap-0.5" title={`${issue.attachment_count} attachments`}>
              <Paperclip size={10} />
              {issue.attachment_count}
            </span>
          ) : null}
          {issue.comment_count > 0 ? (
            <span className="flex items-center gap-0.5" title={`${issue.comment_count} comments`}>
              <MessageSquare size={10} />
              {issue.comment_count}
            </span>
          ) : null}
          {progress ? (
            <span className="flex items-center gap-1" title="Child progress">
              <GitBranch size={10} />
              {progress}
            </span>
          ) : null}
        </span>
      </div>

      {progress ? (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
    </article>
  );
}

export function IssueCard({
  issue,
  projectKey,
}: {
  issue: IssueCardType;
  projectKey: string;
}) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: issue.id,
      data: { type: 'card', issue, stage: issue.stage },
    });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={isDragging ? 'dragging' : undefined}
      {...attributes}
      {...listeners}
    >
      <IssueCardView
        issue={issue}
        projectKey={projectKey}
        onOpen={() => {
          if (!isDragging) {
            navigate(withSearch(`/projects/${projectKey}/issues/${issue.key}`, search));
          }
        }}
      />
    </div>
  );
}
