import { useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client.js';
import { queryKeys } from '../../api/queries.js';
import type { ActorRef, IssueDetail, Module, Stage } from '../../api/types.js';
import { PRIORITIES, STAGES } from '../../api/types.js';
import { stageLabel } from '../../lib/board.js';
import { Spinner } from '../common/Feedback.js';
import { useToast } from '../common/Toast.js';

function CreateIssueForm({
  projectKey,
  defaultStage,
  modules,
  actors,
  onCreated,
  onCancel,
}: {
  projectKey: string;
  defaultStage?: Stage;
  modules: Module[];
  actors: ActorRef[];
  onCreated: (issue: IssueDetail) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stage, setStage] = useState<Stage>(defaultStage ?? 'backlog');
  const [priority, setPriority] = useState('none');
  const [assignee, setAssignee] = useState('');
  const [module, setModule] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.createIssue({
        project: projectKey,
        title,
        description: description || undefined,
        stage,
        priority,
        assignee: assignee || undefined,
        module: module || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['board', projectKey] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      toast.push(`${result.issue.key} created.`, 'success');
      onCreated(result.issue);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : String(cause);
      setError(message);
      toast.push(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium muted">Title</span>
        <input
          className="input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={500}
          autoFocus
          required
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium muted">Description</span>
        <textarea
          className="textarea min-h-24 resize-y"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Markdown is supported."
        />
      </label>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium muted">Stage</span>
          <select
            className="select"
            value={stage}
            onChange={(event) => setStage(event.target.value as Stage)}
          >
            {STAGES.map((entry) => (
              <option key={entry} value={entry}>
                {stageLabel(entry)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium muted">Priority</span>
          <select
            className="select"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            {PRIORITIES.map((entry) => (
              <option key={entry} value={entry}>
                {entry.charAt(0).toUpperCase() + entry.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium muted">Assignee</span>
          <select
            className="select"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
          >
            <option value="">Unassigned</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.name}>
                {actor.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium muted">Module</span>
          <select
            className="select"
            value={module}
            onChange={(event) => setModule(event.target.value)}
          >
            <option value="">No module</option>
            {modules.map((entry) => (
              <option key={entry.id} value={entry.slug}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p className="rounded-md border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={submitting || !title.trim()}>
          {submitting ? <Spinner label="Creating…" /> : null}
          Create Issue
        </button>
      </div>
    </form>
  );
}

export default function CreateIssueModal({
  open,
  onOpenChange,
  projectKey,
  defaultStage,
  modules,
  actors,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectKey: string;
  defaultStage?: Stage;
  modules: Module[];
  actors: ActorRef[];
  onCreated: (issue: IssueDetail) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(620px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-subtle surface p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold">New Issue</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs muted">
                Title is required. Description and metadata can be refined in the drawer.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="btn btn-icon btn-ghost" aria-label="Close">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          {open ? (
            <CreateIssueForm
              key={defaultStage ?? 'backlog'}
              projectKey={projectKey}
              defaultStage={defaultStage}
              modules={modules}
              actors={actors}
              onCreated={(issue) => {
                onCreated(issue);
                onOpenChange(false);
              }}
              onCancel={() => onOpenChange(false)}
            />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
