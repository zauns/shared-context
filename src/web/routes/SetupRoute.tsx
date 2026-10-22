import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Layers } from 'lucide-react';
import { api, ApiError } from '../api/client.js';
import { queryKeys, useConfig, useProjects } from '../api/queries.js';
import { FullPageSpinner, Spinner } from '../components/common/Feedback.js';
import { useToast } from '../components/common/Toast.js';
import { useLastProject } from '../state/local.js';

export default function SetupRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const config = useConfig();
  const projects = useProjects();
  const [, setLastProject] = useLastProject();
  const [ownerName, setOwnerName] = useState('Owner');
  const [projectKey, setProjectKey] = useState('SHC');
  const [projectName, setProjectName] = useState('Shared Context');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (config.isLoading) return <FullPageSpinner />;
  if (config.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center app-bg p-6">
        <div className="w-full max-w-md rounded-xl border border-subtle surface p-5">
          <p className="text-sm font-medium">Cannot reach the daemon</p>
          <p className="mt-1 text-xs muted">{config.error.message}</p>
        </div>
      </div>
    );
  }

  const setupRequired = config.data?.setup_required ?? true;
  const hasProjects = (projects.data?.length ?? 0) > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.setup({
        owner_name: ownerName,
        project_key: projectKey,
        project_name: projectName,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.config });
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      if (result.project) {
        setLastProject(result.project.key);
        navigate(`/projects/${result.project.key}/board`, { replace: true });
      } else {
        navigate('/', { replace: true });
      }
      toast.push('Shared Context is ready.', 'success');
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : String(cause);
      setError(message);
      toast.push(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center app-bg p-6">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Layers size={22} />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] accent-text">
              Shared Context
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {setupRequired ? 'Set up your local tracker' : 'Create a project'}
            </h1>
          </div>
        </div>

        <form onSubmit={submit} className="rounded-xl border border-subtle surface p-5 shadow-xl">
          <p className="text-sm muted">
            {setupRequired
              ? 'Create the human owner and the first Project. Everything stays on this machine.'
              : 'Add another Project. The existing owner is reused.'}
          </p>

          {setupRequired ? (
            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-medium muted">Your display name</span>
              <input
                className="input"
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
                maxLength={64}
                required
              />
            </label>
          ) : null}

          <div className="mt-4 grid grid-cols-[110px_1fr] gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium muted">Project key</span>
              <input
                className="input font-mono uppercase"
                value={projectKey}
                onChange={(event) => setProjectKey(event.target.value.toUpperCase())}
                maxLength={6}
                pattern="[A-Z][A-Z0-9]{1,5}"
                title="2–6 characters: a letter followed by letters or digits"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium muted">Project name</span>
              <input
                className="input"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
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

          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => navigate('/')}
              disabled={submitting}
            >
              Back
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? <Spinner label="Creating…" /> : <ArrowRight size={14} />}
              {setupRequired ? 'Create workspace' : 'Create project'}
            </button>
          </div>
          {!hasProjects && !setupRequired ? (
            <p className="mt-3 text-xs muted">No Projects yet. Create one to open the board.</p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
