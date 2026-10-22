import { useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client.js';
import { queryKeys } from '../api/queries.js';
import type { ProjectSummary } from '../api/types.js';
import { Spinner } from './common/Feedback.js';
import { useToast } from './common/Toast.js';

export default function ProjectModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (project: ProjectSummary) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.createProject({ key, name });
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      toast.push(`Project ${result.project.key} created.`, 'success');
      onCreated(result.project);
      onOpenChange(false);
      setKey('');
      setName('');
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : String(cause);
      setError(message);
      toast.push(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-subtle surface p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold">New project</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs muted">
                Projects are curated here. Agents can create Modules, not Projects.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="btn btn-icon btn-ghost" aria-label="Close">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={submit} className="mt-5">
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium muted">Key</span>
                <input
                  className="input font-mono uppercase"
                  value={key}
                  onChange={(event) => setKey(event.target.value.toUpperCase())}
                  maxLength={6}
                  pattern="[A-Z][A-Z0-9]{1,5}"
                  title="2–6 characters: a letter followed by letters or digits"
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium muted">Name</span>
                <input
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={200}
                  required
                />
              </label>
            </div>

            {error ? (
              <p className="mt-3 rounded-md border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button type="button" className="btn btn-ghost" disabled={submitting}>
                  Cancel
                </button>
              </Dialog.Close>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? <Spinner label="Creating…" /> : null}
                Create project
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
