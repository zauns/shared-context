import { useParams } from 'react-router';
import { FolderKanban, Settings } from 'lucide-react';
import { useModules, useProjects } from '../api/queries.js';
import { ErrorState, FullPageSpinner } from '../components/common/Feedback.js';
import { relativeTime, stageLabel } from '../lib/board.js';
import { STAGES } from '../api/types.js';

export default function ProjectSettingsRoute() {
  const { projectKey = '' } = useParams();
  const projects = useProjects();
  const modules = useModules(projectKey || undefined);
  const project = projects.data?.find((entry) => entry.key === projectKey);

  if (projects.isLoading) return <FullPageSpinner />;
  if (projects.isError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <ErrorState
          title="Cannot load Projects"
          message={projects.error.message}
          onRetry={() => void projects.refetch()}
        />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <ErrorState title="Project not found" message={`No Project with key ${projectKey}.`} />
      </div>
    );
  }

  return (
    <div className="scrollbar flex-1 overflow-y-auto">
      <header className="flex items-center gap-2 border-b border-subtle px-4 py-3 surface">
        <Settings size={16} className="muted" />
        <h1 className="text-lg font-semibold tracking-tight">Project settings</h1>
        <span className="chip font-mono">{project.key}</span>
      </header>

      <div className="mx-auto max-w-3xl space-y-7 px-5 py-6">
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] muted">
            Identity
          </h2>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] muted">
                Name
              </dt>
              <dd className="mt-1 text-sm">{project.name}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] muted">
                Key
              </dt>
              <dd className="mt-1 font-mono text-sm">{project.key}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] muted">
                Description
              </dt>
              <dd className="mt-1 text-sm">
                {project.description || <span className="muted">No description.</span>}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] muted">
                Root path
              </dt>
              <dd className="mt-1 break-all font-mono text-xs">
                {project.root_path || <span className="muted">Not set.</span>}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] muted">
                Issues
              </dt>
              <dd className="mt-1 text-sm">{project.counts.total}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] muted">
                Blocked
              </dt>
              <dd className="mt-1 text-sm">{project.counts.blocked}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] muted">
            Stages
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((stage) => (
              <span key={stage} className="chip">
                {stageLabel(stage)} {project.counts.by_stage[stage]}
              </span>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] muted">
            <FolderKanban size={12} /> Modules
            <span className="chip">{(modules.data ?? project.modules).length}</span>
          </h2>
          <div className="space-y-1">
            {(modules.data ?? project.modules).map((module) => (
              <div
                key={module.id}
                className="flex items-center gap-2 rounded-md border border-subtle px-2.5 py-1.5 text-xs"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: module.color ?? 'var(--border)' }}
                />
                <span className="min-w-0 flex-1 truncate">{module.name}</span>
                <span className="font-mono text-[10px] muted">{module.slug}</span>
              </div>
            ))}
            {(modules.data ?? project.modules).length === 0 ? (
              <p className="text-xs muted">No Modules yet.</p>
            ) : null}
          </div>
        </section>

        <p className="text-[11px] muted">
          Updated {relativeTime(project.updated_at)}. Editing Project details, the doc
          allowlist, trash, export, and backups arrive in M7.
        </p>
      </div>
    </div>
  );
}