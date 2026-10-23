import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import {
  Ban,
  Check,
  GitBranch,
  MessageSquare,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError } from '../../api/client.js';
import { useActors, useIssue, useIssueOptions, useModules } from '../../api/queries.js';
import type { Comment, IssueDetail } from '../../api/types.js';
import { PRIORITIES, STAGES } from '../../api/types.js';
import {
  childProgressLabel,
  childProgressPercent,
  priorityClass,
  priorityLabel,
  relativeTime,
  stageLabel,
} from '../../lib/board.js';
import { ErrorState, Spinner } from '../common/Feedback.js';
import { useToast } from '../common/Toast.js';
import { useRecentIssues } from '../../state/local.js';
import AttachmentsSection from './AttachmentsSection.js';
import LinksSection from './LinksSection.js';

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] muted">{label}</dt>
      <dd className="mt-1 text-xs">{children}</dd>
    </div>
  );
}

export default function IssueDrawer({
  issueKey,
  onClose,
}: {
  issueKey: string;
  onClose: () => void;
}) {
  const issueQuery = useIssue(issueKey);

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
          <IssueDrawerContent issue={issueQuery.data} onClose={onClose} />
        ) : null}
      </aside>
    </>
  );
}

function IssueDrawerContent({
  issue,
  onClose,
}: {
  issue: IssueDetail;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const actors = useActors();
  const modules = useModules(issue.project.key);
  const issueOptions = useIssueOptions(issue.project.key);

  const [baseRev, setBaseRev] = useState(issue.rev);
  const [baseTitle, setBaseTitle] = useState(issue.title);
  const [baseDescription, setBaseDescription] = useState(issue.description);
  const [titleDraft, setTitleDraft] = useState(issue.title);
  const [descriptionDraft, setDescriptionDraft] = useState(issue.description);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionMode, setDescriptionMode] = useState<'write' | 'preview'>('write');
  const [saving, setSaving] = useState<string | null>(null);
  const [conflictIssue, setConflictIssue] = useState<IssueDetail | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cascade, setCascade] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [childTitle, setChildTitle] = useState('');
  const [childError, setChildError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [confirmCommentId, setConfirmCommentId] = useState<string | null>(null);

  const { remember: rememberRecentIssue } = useRecentIssues();
  useEffect(() => {
    rememberRecentIssue({
      key: issue.key,
      title: issue.title,
      projectKey: issue.project.key,
      projectName: issue.project.name,
      stage: issue.stage,
    });
  }, [
    issue.key,
    issue.title,
    issue.stage,
    issue.project.key,
    issue.project.name,
    rememberRecentIssue,
  ]);

  const current = conflictIssue ?? issue;
  const dirty = titleDraft !== baseTitle || descriptionDraft !== baseDescription;
  const serverChanged = current.rev !== baseRev;
  const showConflict = Boolean(conflictIssue) || (serverChanged && dirty);
  const titleDirty = titleDraft !== baseTitle;
  const descriptionDirty = descriptionDraft !== baseDescription;

  function applyIssue(updated: IssueDetail) {
    queryClient.setQueryData(['issue', updated.key], updated);
    setBaseRev(updated.rev);
    setConflictIssue(null);
    void queryClient.invalidateQueries({ queryKey: ['issue', updated.key] });
    void queryClient.invalidateQueries({ queryKey: ['board', updated.project.key] });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    void queryClient.invalidateQueries({ queryKey: ['issue-options', updated.project.key] });
  }

  function handleError(cause: unknown, fallback: string) {
    if (cause instanceof ApiError && cause.status === 409) {
      const latest = cause.issue as IssueDetail | undefined;
      if (latest) setConflictIssue(latest);
      toast.push('This Issue changed while you were editing. Reload latest or copy your draft.', 'error');
      void queryClient.invalidateQueries({ queryKey: ['issue', issue.key] });
      return;
    }
    toast.push(cause instanceof ApiError ? cause.message : fallback, 'error');
  }

  async function saveMetadata(
    patch: {
      priority?: string;
      assignee?: string | null;
      module?: string | null;
      parent?: string | null;
    },
    label: string,
  ) {
    setSaving(label);
    try {
      const result = await api.updateIssue(issue.key, {
        expected_rev: current.rev,
        ...patch,
      });
      applyIssue(result.issue);
      toast.push('Issue updated.', 'success');
    } catch (cause) {
      handleError(cause, 'Could not update the Issue');
    } finally {
      setSaving(null);
    }
  }

  async function saveStage(stage: string) {
    setSaving('stage');
    try {
      const result = await api.moveIssue(issue.key, {
        expected_rev: current.rev,
        stage,
      });
      applyIssue(result.issue);
      toast.push(`Moved to ${stageLabel(result.issue.stage)}.`, 'success');
    } catch (cause) {
      handleError(cause, 'Could not move the Issue');
    } finally {
      setSaving(null);
    }
  }

  async function saveTitle() {
    if (!titleDraft.trim()) {
      toast.push('Title cannot be empty.', 'error');
      return;
    }
    setSaving('title');
    try {
      const result = await api.updateIssue(issue.key, {
        expected_rev: current.rev,
        title: titleDraft.trim(),
      });
      applyIssue(result.issue);
      setBaseTitle(result.issue.title);
      setTitleDraft(result.issue.title);
      toast.push('Title saved.', 'success');
    } catch (cause) {
      handleError(cause, 'Could not save the title');
    } finally {
      setSaving(null);
    }
  }

  async function saveDescription() {
    setSaving('description');
    try {
      const result = await api.updateIssue(issue.key, {
        expected_rev: current.rev,
        description: descriptionDraft,
      });
      applyIssue(result.issue);
      setBaseDescription(result.issue.description);
      setDescriptionDraft(result.issue.description);
      setEditingDescription(false);
      setDescriptionMode('write');
      toast.push('Description saved.', 'success');
    } catch (cause) {
      handleError(cause, 'Could not save the description');
    } finally {
      setSaving(null);
    }
  }

  function reloadLatest() {
    const latest = conflictIssue ?? issue;
    setTitleDraft(latest.title);
    setDescriptionDraft(latest.description);
    setBaseTitle(latest.title);
    setBaseDescription(latest.description);
    setBaseRev(latest.rev);
    setConflictIssue(null);
    setEditingDescription(false);
    setDescriptionMode('write');
    toast.push('Reloaded the latest Issue.', 'info');
  }

  function copyDraft() {
    const text = `${titleDraft}\n\n${descriptionDraft}`;
    void navigator.clipboard?.writeText(text);
    toast.push('Draft copied to the clipboard.', 'info');
  }

  async function blockIssue() {
    if (!blockReason.trim()) return;
    setSaving('blocked');
    try {
      const result = await api.blockIssue(issue.key, {
        expected_rev: current.rev,
        reason: blockReason.trim(),
      });
      applyIssue(result.issue);
      setBlockOpen(false);
      setBlockReason('');
      toast.push('Issue blocked.', 'success');
    } catch (cause) {
      handleError(cause, 'Could not block the Issue');
    } finally {
      setSaving(null);
    }
  }

  async function unblockIssue() {
    setSaving('blocked');
    try {
      const result = await api.unblockIssue(issue.key, { expected_rev: current.rev });
      applyIssue(result.issue);
      toast.push('Issue unblocked.', 'success');
    } catch (cause) {
      handleError(cause, 'Could not unblock the Issue');
    } finally {
      setSaving(null);
    }
  }

  async function claimIssue() {
    setSaving('assignee');
    try {
      const result = await api.claimIssue(issue.key);
      applyIssue(result.issue);
      toast.push('Issue claimed.', 'success');
    } catch (cause) {
      handleError(cause, 'Could not claim the Issue');
    } finally {
      setSaving(null);
    }
  }

  async function releaseIssue() {
    setSaving('assignee');
    try {
      const result = await api.releaseIssue(issue.key);
      applyIssue(result.issue);
      toast.push('Issue released.', 'success');
    } catch (cause) {
      handleError(cause, 'Could not release the Issue');
    } finally {
      setSaving(null);
    }
  }

  async function addChild() {
    if (!childTitle.trim()) return;
    setChildError(null);
    setSaving('child');
    try {
      await api.createIssue({
        project: issue.project.key,
        title: childTitle.trim(),
        parent: issue.key,
      });
      setChildTitle('');
      await queryClient.invalidateQueries({ queryKey: ['issue', issue.key] });
      await queryClient.invalidateQueries({ queryKey: ['board', issue.project.key] });
      await queryClient.invalidateQueries({ queryKey: ['issue-options', issue.project.key] });
      toast.push('Child Issue created.', 'success');
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : String(cause);
      setChildError(message);
      toast.push(message, 'error');
    } finally {
      setSaving(null);
    }
  }

  async function addComment() {
    if (!commentBody.trim()) return;
    setCommentError(null);
    setSaving('comment');
    try {
      await api.addComment(issue.key, { body: commentBody.trim() });
      setCommentBody('');
      await queryClient.invalidateQueries({ queryKey: ['issue', issue.key] });
      toast.push('Comment added.', 'success');
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : String(cause);
      setCommentError(message);
      toast.push(message, 'error');
    } finally {
      setSaving(null);
    }
  }

  function startEditComment(comment: Comment) {
    setEditingCommentId(comment.id);
    setCommentDraft(comment.body);
    setConfirmCommentId(null);
  }

  async function saveComment(comment: Comment) {
    if (!commentDraft.trim()) return;
    setSaving('comment-edit');
    try {
      await api.updateComment(comment.id, {
        body: commentDraft,
        expected_rev: comment.rev,
      });
      setEditingCommentId(null);
      setCommentDraft('');
      await queryClient.invalidateQueries({ queryKey: ['issue', issue.key] });
      toast.push('Comment updated.', 'success');
    } catch (cause) {
      handleError(cause, 'Could not update the comment');
    } finally {
      setSaving(null);
    }
  }

  async function deleteComment(comment: Comment) {
    setSaving('comment-delete');
    try {
      await api.deleteComment(comment.id);
      setConfirmCommentId(null);
      await queryClient.invalidateQueries({ queryKey: ['issue', issue.key] });
      toast.push('Comment deleted.', 'success');
    } catch (cause) {
      handleError(cause, 'Could not delete the comment');
    } finally {
      setSaving(null);
    }
  }

  async function deleteIssue() {
    setSaving('delete');
    try {
      await api.deleteIssue(issue.key, {
        expected_rev: current.rev,
        cascade,
        reason: deleteReason.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['board', issue.project.key] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      await queryClient.invalidateQueries({ queryKey: ['issue-options', issue.project.key] });
      toast.push(`${issue.key} deleted.`, 'success');
      setDeleteOpen(false);
      onClose();
      navigate(`/projects/${issue.project.key}/board`);
    } catch (cause) {
      handleError(cause, 'Could not delete the Issue');
    } finally {
      setSaving(null);
    }
  }

  const parentOptions =
    issueOptions.data?.items.filter((entry) => entry.id !== issue.id) ?? [];

  return (
    <div className="pb-10">
      <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-subtle surface px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip font-mono">{current.key}</span>
            <span className={`chip ${priorityClass(current.priority)}`}>
              {priorityLabel(current.priority)}
            </span>
            <span className="chip">{stageLabel(current.stage)}</span>
            {current.blocked ? (
              <span className="chip priority-urgent">
                <Ban size={10} />
                Blocked
              </span>
            ) : null}
            <span className="text-[10px] muted">rev {current.rev}</span>
            {dirty ? <span className="chip chip-active">Unsaved</span> : null}
          </div>
          <input
            className="mt-2 w-full border-0 border-b border-transparent bg-transparent text-xl font-semibold leading-tight outline-none focus:border-[var(--accent)]"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            aria-label="Issue title"
          />
          {titleDirty ? (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveTitle()}
                disabled={saving !== null || serverChanged}
              >
                {saving === 'title' ? <Spinner label="Saving…" /> : <Check size={13} />}
                Save title
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setTitleDraft(baseTitle)}
                disabled={saving !== null}
              >
                Cancel
              </button>
            </div>
          ) : null}
          <p className="mt-1 text-[11px] muted">
            Updated {relativeTime(current.updated_at)} · created by {current.created_by.name}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="btn btn-icon btn-ghost text-[var(--danger)]"
            onClick={() => setDeleteOpen(true)}
            aria-label="Delete Issue"
            title="Delete Issue"
          >
            <Trash2 size={16} />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={onClose}
            aria-label="Close Issue"
          >
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="space-y-7 px-5 py-5">
        {showConflict ? (
          <div className="rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] p-3">
            <p className="text-xs font-medium">
              This Issue changed while you were editing. Nothing was overwritten.
            </p>
            <p className="mt-1 text-[11px] muted">
              Reload the latest version, or copy your draft before reloading.
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn btn-primary" onClick={reloadLatest}>
                Reload latest
              </button>
              <button type="button" className="btn" onClick={copyDraft}>
                Copy draft
              </button>
            </div>
          </div>
        ) : serverChanged ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-subtle bg-[var(--surface-2)] p-3 text-[11px]">
            <span>Someone updated this Issue.</span>
            <button type="button" className="btn" onClick={reloadLatest}>
              Reload latest
            </button>
          </div>
        ) : null}

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Meta label="Stage">
            <select
              className="select"
              value={current.stage}
              onChange={(event) => void saveStage(event.target.value)}
              disabled={saving !== null}
            >
              {STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {stageLabel(stage)}
                </option>
              ))}
            </select>
          </Meta>
          <Meta label="Priority">
            <select
              className="select"
              value={current.priority}
              onChange={(event) => void saveMetadata({ priority: event.target.value }, 'priority')}
              disabled={saving !== null}
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priorityLabel(priority)}
                </option>
              ))}
            </select>
          </Meta>
          <Meta label="Assignee">
            <div className="flex gap-1">
              <select
                className="select"
                value={current.assignee?.name ?? ''}
                onChange={(event) =>
                  void saveMetadata({ assignee: event.target.value || null }, 'assignee')
                }
                disabled={saving !== null}
              >
                <option value="">Unassigned</option>
                {(actors.data ?? []).map((actor) => (
                  <option key={actor.id} value={actor.name}>
                    {actor.name}
                  </option>
                ))}
              </select>
              {current.assignee ? (
                <button
                  type="button"
                  className="btn btn-ghost shrink-0"
                  onClick={() => void releaseIssue()}
                  disabled={saving !== null}
                  title="Release this Issue"
                >
                  Release
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost shrink-0"
                  onClick={() => void claimIssue()}
                  disabled={saving !== null}
                  title="Claim this Issue"
                >
                  Claim
                </button>
              )}
            </div>
          </Meta>
          <Meta label="Module">
            <select
              className="select"
              value={current.module?.slug ?? ''}
              onChange={(event) =>
                void saveMetadata({ module: event.target.value || null }, 'module')
              }
              disabled={saving !== null}
            >
              <option value="">None</option>
              {(modules.data ?? []).map((module) => (
                <option key={module.id} value={module.slug}>
                  {module.name}
                </option>
              ))}
            </select>
          </Meta>
          <Meta label="Parent">
            <select
              className="select"
              value={current.parent?.key ?? ''}
              onChange={(event) =>
                void saveMetadata({ parent: event.target.value || null }, 'parent')
              }
              disabled={saving !== null}
            >
              <option value="">None</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.key}>
                  {option.key} — {option.title}
                </option>
              ))}
            </select>
          </Meta>
          <Meta label="Blocked">
            <div className="flex flex-wrap items-center gap-1.5">
              {current.blocked ? (
                <>
                  <span className="text-[var(--danger)]">{current.blocked_reason}</span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void unblockIssue()}
                    disabled={saving !== null}
                  >
                    Unblock
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setBlockOpen(true)}
                  disabled={saving !== null}
                >
                  <Ban size={12} />
                  Block Issue
                </button>
              )}
            </div>
          </Meta>
        </dl>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] muted">
              Description
            </h3>
            {!editingDescription ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setEditingDescription(true);
                  setDescriptionMode('write');
                }}
              >
                Edit
              </button>
            ) : (
              <div className="flex gap-1">
                <button
                  type="button"
                  className={`btn ${descriptionMode === 'write' ? 'chip-active' : ''}`}
                  onClick={() => setDescriptionMode('write')}
                >
                  Write
                </button>
                <button
                  type="button"
                  className={`btn ${descriptionMode === 'preview' ? 'chip-active' : ''}`}
                  onClick={() => setDescriptionMode('preview')}
                >
                  Preview
                </button>
              </div>
            )}
          </div>

          {editingDescription ? (
            <div>
              {descriptionMode === 'write' ? (
                <textarea
                  className="textarea min-h-40 resize-y font-mono text-xs"
                  value={descriptionDraft}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  placeholder="Markdown is supported."
                />
              ) : (
                <div className="min-h-24 rounded-lg border border-subtle bg-[var(--surface-2)] p-3">
                  {descriptionDraft ? (
                    <div className="markdown">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeSanitize]}
                      >
                        {descriptionDraft}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-xs muted">Nothing to preview.</p>
                  )}
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void saveDescription()}
                  disabled={saving !== null || !descriptionDirty || serverChanged}
                >
                  {saving === 'description' ? <Spinner label="Saving…" /> : <Check size={13} />}
                  Save description
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setDescriptionDraft(baseDescription);
                    setEditingDescription(false);
                    setDescriptionMode('write');
                  }}
                  disabled={saving !== null}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : descriptionDraft ? (
            <div className="markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                {descriptionDraft}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-xs muted">No description.</p>
          )}
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] muted">
            <GitBranch size={12} /> Children
            <span className="chip">{childProgressLabel(current) ?? '0/0'}</span>
          </h3>
          <div className="h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
            <div
              className="h-full bg-[var(--accent)] transition-[width]"
              style={{ width: `${childProgressPercent(current)}%` }}
            />
          </div>
          <div className="mt-2 space-y-1">
            {current.children.map((child) => (
              <Link
                key={child.id}
                to={`/projects/${issue.project.key}/issues/${child.key}`}
                className="flex items-center gap-2 rounded-md border border-subtle px-2 py-1.5 text-xs hover:bg-[var(--surface-2)]"
              >
                <span className="font-mono text-[10px] muted">{child.key}</span>
                <span className="min-w-0 flex-1 truncate">{child.title}</span>
                <span className="chip">{stageLabel(child.stage)}</span>
              </Link>
            ))}
            {current.children.length === 0 ? (
              <p className="text-xs muted">No children.</p>
            ) : null}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className="input"
              placeholder="New child Issue title"
              value={childTitle}
              maxLength={500}
              onChange={(event) => setChildTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void addChild();
              }}
            />
            <button
              type="button"
              className="btn shrink-0"
              onClick={() => void addChild()}
              disabled={!childTitle.trim() || saving !== null}
            >
              Add child
            </button>
          </div>
          {childError ? <p className="mt-1 text-[11px] text-[var(--danger)]">{childError}</p> : null}
        </section>

        <AttachmentsSection issue={current} />

        <LinksSection issue={current} />

        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] muted">
            <MessageSquare size={12} /> Comments
          </h3>
          <div className="space-y-2">
            {current.comments.map((comment) => (
              <div key={comment.id} className="rounded-lg border border-subtle p-2.5">
                <div className="mb-1 flex items-center gap-2 text-[10px] muted">
                  <span className="font-medium text-[var(--text)]">{comment.author.name}</span>
                  <span>{relativeTime(comment.created_at)}</span>
                  {comment.author.kind === 'human' ? (
                    <span className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        className="btn btn-ghost px-1.5 py-0.5"
                        onClick={() => startEditComment(comment)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost px-1.5 py-0.5 text-[var(--danger)]"
                        onClick={() => setConfirmCommentId(comment.id)}
                      >
                        Delete
                      </button>
                    </span>
                  ) : null}
                </div>
                {editingCommentId === comment.id ? (
                  <div>
                    <textarea
                      className="textarea min-h-20 resize-y text-xs"
                      value={commentDraft}
                      onChange={(event) => setCommentDraft(event.target.value)}
                    />
                    <div className="mt-1.5 flex gap-2">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void saveComment(comment)}
                        disabled={saving !== null || !commentDraft.trim()}
                      >
                        Save comment
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          setEditingCommentId(null);
                          setCommentDraft('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                      {comment.body}
                    </ReactMarkdown>
                  </div>
                )}
                {confirmCommentId === comment.id ? (
                  <div className="mt-2 flex items-center gap-2 text-[11px]">
                    <span>Delete this comment?</span>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => void deleteComment(comment)}
                      disabled={saving !== null}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setConfirmCommentId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
            {current.comments.length === 0 ? (
              <p className="text-xs muted">No comments yet.</p>
            ) : null}
          </div>
          <div className="mt-2">
            <textarea
              className="textarea min-h-20 resize-y text-xs"
              placeholder="Add a Markdown comment…"
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              {commentError ? (
                <p className="text-[11px] text-[var(--danger)]">{commentError}</p>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void addComment()}
                disabled={!commentBody.trim() || saving !== null}
              >
                {saving === 'comment' ? <Spinner label="Adding…" /> : null}
                Add comment
              </button>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] muted">
            Recent activity
          </h3>
          <div className="space-y-1.5">
            {current.activity.slice(0, 12).map((event) => (
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
            {current.activity.length === 0 ? (
              <p className="text-xs muted">No activity yet.</p>
            ) : null}
          </div>
        </section>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="btn"
            onClick={() => navigate(`/projects/${issue.project.key}/board`)}
          >
            Back to board
          </button>
        </div>
      </div>

      <Dialog.Root open={blockOpen} onOpenChange={setBlockOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-subtle surface p-5 shadow-2xl">
            <Dialog.Title className="text-base font-semibold">Block {current.key}</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs muted">
              The Stage does not change. A reason is required.
            </Dialog.Description>
            <textarea
              className="textarea mt-3 min-h-24 resize-y"
              placeholder="What is blocking this Issue?"
              value={blockReason}
              onChange={(event) => setBlockReason(event.target.value)}
              maxLength={2000}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button type="button" className="btn btn-ghost">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void blockIssue()}
                disabled={!blockReason.trim() || saving !== null}
              >
                Block Issue
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-subtle surface p-5 shadow-2xl">
            <Dialog.Title className="text-base font-semibold">Delete {current.key}?</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs muted">
              This is a soft delete. The Issue and its Activity remain recoverable from Trash.
            </Dialog.Description>
            {current.children.length > 0 ? (
              <label className="mt-3 flex items-start gap-2 rounded-md border border-[var(--warning)] bg-[var(--warning-soft)] p-2 text-xs">
                <input
                  type="checkbox"
                  checked={cascade}
                  onChange={(event) => setCascade(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Delete the {current.children.length} child Issue
                  {current.children.length === 1 ? '' : 's'} too.
                </span>
              </label>
            ) : null}
            <input
              className="input mt-3"
              placeholder="Reason (optional)"
              value={deleteReason}
              maxLength={2000}
              onChange={(event) => setDeleteReason(event.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button type="button" className="btn btn-ghost">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void deleteIssue()}
                disabled={saving !== null}
              >
                Delete Issue
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
