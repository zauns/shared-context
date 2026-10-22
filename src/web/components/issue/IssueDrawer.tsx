import { Link, useNavigate } from 'react-router';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import {
  Ban,
  GitBranch,
  Link2,
  MessageSquare,
  Paperclip,
  X,
} from 'lucide-react';
import { useIssue } from '../../api/queries.js';
import {
  childProgressLabel,
  childProgressPercent,
  priorityClass,
  priorityLabel,
  relativeTime,
  stageLabel,
} from '../../lib/board.js';
import { ErrorState, Spinner } from '../common/Feedback.js';

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] muted">{label}</dt>
      <dd className="mt-1 text-xs">{children}</dd>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function IssueDrawer({
  issueKey,
  onClose,
}: {
  issueKey: string;
  onClose: () => void;
}) {
  const issueQuery = useIssue(issueKey);
  const navigate = useNavigate();

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        className="drawer scrollbar"
        role="dialog"
        aria-modal="true"
        aria-label={`Issue ${issueKey}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-subtle surface px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip font-mono">{issueKey}</span>
              {issueQuery.data ? (
                <>
                  <span className={`chip ${priorityClass(issueQuery.data.priority)}`}>
                    {priorityLabel(issueQuery.data.priority)}
                  </span>
                  <span className="chip">{stageLabel(issueQuery.data.stage)}</span>
                  {issueQuery.data.blocked ? (
                    <span className="chip priority-urgent">
                      <Ban size={10} />
                      Blocked
                    </span>
                  ) : null}
                  <span className="text-[10px] muted">rev {issueQuery.data.rev}</span>
                </>
              ) : null}
            </div>
            <h2 className="mt-2 text-xl font-semibold leading-tight">
              {issueQuery.data?.title ?? 'Loading…'}
            </h2>
            {issueQuery.data ? (
              <p className="mt-1 text-[11px] muted">
                Updated {relativeTime(issueQuery.data.updated_at)} · created by{' '}
                {issueQuery.data.created_by.name}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-icon btn-ghost shrink-0"
            onClick={onClose}
            aria-label="Close Issue"
          >
            <X size={17} />
          </button>
        </header>

        {issueQuery.isLoading ? (
          <div className="p-6">
            <Spinner label="Loading Issue…" />
          </div>
        ) : issueQuery.isError ? (
          <ErrorState
            title="Cannot load Issue"
            message={issueQuery.error.message}
            onRetry={() => void issueQuery.refetch()}
          />
        ) : issueQuery.data ? (
          <div className="space-y-7 px-5 py-5">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Meta label="Assignee">
                {issueQuery.data.assignee?.name ?? <span className="muted">Unassigned</span>}
              </Meta>
              <Meta label="Module">
                {issueQuery.data.module?.name ?? <span className="muted">None</span>}
              </Meta>
              <Meta label="Parent">
                {issueQuery.data.parent ? (
                  <Link
                    to={`/projects/${issueQuery.data.project.key}/issues/${issueQuery.data.parent.key}`}
                    className="accent-text hover:underline"
                  >
                    {issueQuery.data.parent.key}
                  </Link>
                ) : (
                  <span className="muted">None</span>
                )}
              </Meta>
              <Meta label="Priority">{priorityLabel(issueQuery.data.priority)}</Meta>
              <Meta label="Stage">{stageLabel(issueQuery.data.stage)}</Meta>
              <Meta label="Blocked">
                {issueQuery.data.blocked ? (
                  <span className="text-[var(--danger)]">
                    {issueQuery.data.blocked_reason ?? 'Yes'}
                  </span>
                ) : (
                  <span className="muted">No</span>
                )}
              </Meta>
            </dl>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] muted">
                Description
              </h3>
              {issueQuery.data.description ? (
                <div className="markdown">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeSanitize]}
                  >
                    {issueQuery.data.description}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-xs muted">No description.</p>
              )}
            </section>

            {issueQuery.data.children.length > 0 ? (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] muted">
                  <GitBranch size={12} /> Children
                  <span className="chip">
                    {childProgressLabel(issueQuery.data) ?? ''}
                  </span>
                </h3>
                <div className="h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <div
                    className="h-full bg-[var(--accent)]"
                    style={{ width: `${childProgressPercent(issueQuery.data)}%` }}
                  />
                </div>
                <div className="mt-2 space-y-1">
                  {issueQuery.data.children.map((child) => (
                    <Link
                      key={child.id}
                      to={`/projects/${issueQuery.data.project.key}/issues/${child.key}`}
                      className="flex items-center gap-2 rounded-md border border-subtle px-2 py-1.5 text-xs hover:bg-[var(--surface-2)]"
                    >
                      <span className="font-mono text-[10px] muted">{child.key}</span>
                      <span className="min-w-0 flex-1 truncate">{child.title}</span>
                      <span className="chip">{stageLabel(child.stage)}</span>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            {issueQuery.data.attachments.length > 0 ? (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] muted">
                  <Paperclip size={12} /> Attachments
                </h3>
                <div className="space-y-1">
                  {issueQuery.data.attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-center gap-2 rounded-md border border-subtle px-2 py-1.5 text-xs"
                      title="Opening attachments arrives in M6"
                    >
                      <Paperclip size={12} className="muted" />
                      <span className="min-w-0 flex-1 truncate">{attachment.original_name}</span>
                      <span className="text-[10px] muted">{formatBytes(attachment.size_bytes)}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {issueQuery.data.links.length > 0 ? (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] muted">
                  <Link2 size={12} /> Links
                </h3>
                <div className="space-y-1">
                  {issueQuery.data.links.map((link) => (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-md border border-subtle px-2 py-1.5 text-xs hover:bg-[var(--surface-2)]"
                    >
                      <Link2 size={12} className="muted" />
                      <span className="min-w-0 flex-1 truncate">
                        {link.label ?? link.url}
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            ) : null}

            {issueQuery.data.comments.length > 0 ? (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] muted">
                  <MessageSquare size={12} /> Comments
                </h3>
                <div className="space-y-2">
                  {issueQuery.data.comments.map((comment) => (
                    <div key={comment.id} className="rounded-lg border border-subtle p-2.5">
                      <p className="mb-1 text-[10px] muted">
                        {comment.author.name} · {relativeTime(comment.created_at)}
                      </p>
                      <div className="markdown">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeSanitize]}
                        >
                          {comment.body}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] muted">
                Recent activity
              </h3>
              <div className="space-y-1.5">
                {issueQuery.data.activity.slice(0, 12).map((event) => (
                  <div key={event.id} className="flex items-start gap-2 text-[11px]">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                    <div className="min-w-0">
                      <span className="font-medium">{event.actor_name}</span>{' '}
                      <span className="muted">{event.type.replaceAll('_', ' ')}</span>
                      <span className="muted"> · {relativeTime(event.at)}</span>
                      {event.changes.length > 0 ? (
                        <span className="muted">
                          {' '}
                          ({event.changes.map((change) => change.field).join(', ')})
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
                {issueQuery.data.activity.length === 0 ? (
                  <p className="text-xs muted">No activity yet.</p>
                ) : null}
              </div>
            </section>

            <p className="rounded-md border border-subtle bg-[var(--surface-2)] px-3 py-2 text-[11px] muted">
              Read-only detail in M4. Editing, comments, and attachments arrive in M5–M6.
            </p>

            <div className="flex justify-end">
              <button
                type="button"
                className="btn"
                onClick={() =>
                  navigate(`/projects/${issueQuery.data.project.key}/board`)
                }
              >
                Back to board
              </button>
            </div>
          </div>
        ) : null}
      </aside>
    </>
  );
}
