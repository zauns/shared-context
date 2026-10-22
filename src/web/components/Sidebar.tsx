import { Link } from 'react-router';
import { LayoutGrid, Moon, Plus, SlidersHorizontal, Sun } from 'lucide-react';
import type { ProjectSummary } from '../api/types.js';

export default function Sidebar({
  projects,
  activeKey,
  theme,
  onToggleTheme,
  density,
  onToggleDensity,
  onNewProject,
}: {
  projects: ProjectSummary[];
  activeKey: string;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  density: 'compact' | 'comfortable';
  onToggleDensity: () => void;
  onNewProject: () => void;
}) {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-subtle surface md:flex">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
          <LayoutGrid size={18} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Shared Context</p>
          <p className="text-[10px] uppercase tracking-[0.2em] muted">Local tracker</p>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 pb-2 pt-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] muted">
          Projects
        </span>
        <button
          type="button"
          className="btn btn-icon btn-ghost"
          onClick={onNewProject}
          aria-label="New project"
          title="New project"
        >
          <Plus size={15} />
        </button>
      </div>

      <nav className="scrollbar flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {projects.map((project) => {
          const active = project.key === activeKey;
          return (
            <Link
              key={project.id}
              to={`/projects/${project.key}/board`}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition ${
                active
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
              }`}
            >
              <span
                className={`flex h-6 w-9 shrink-0 items-center justify-center rounded-md border font-mono text-[10px] font-semibold ${
                  active
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-subtle muted'
                }`}
              >
                {project.key}
              </span>
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              <span className="text-[10px] tabular-nums muted">{project.counts.total}</span>
            </Link>
          );
        })}
        {projects.length === 0 ? (
          <p className="px-2.5 py-2 text-xs muted">No Projects yet.</p>
        ) : null}
      </nav>

      <div className="flex items-center gap-2 border-t border-subtle px-3 py-3">
        <button
          type="button"
          className="btn btn-ghost flex-1 justify-start"
          onClick={onToggleTheme}
          title="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
        <button
          type="button"
          className="btn btn-icon btn-ghost"
          onClick={onToggleDensity}
          title={`Switch to ${density === 'compact' ? 'comfortable' : 'compact'} density`}
          aria-label="Toggle density"
        >
          <SlidersHorizontal size={14} />
        </button>
      </div>
    </aside>
  );
}
