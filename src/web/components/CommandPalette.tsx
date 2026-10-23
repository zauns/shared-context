import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  FolderKanban,
  LayoutGrid,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
} from 'lucide-react';
import { api } from '../api/client.js';
import type { ProjectSummary, SearchResultItem } from '../api/types.js';
import { stageLabel } from '../lib/board.js';
import { useRecentIssues, useRecentProjects } from '../state/local.js';

type Group = 'Actions' | 'Issues' | 'Projects';

interface PaletteItem {
  id: string;
  group: Group;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  icon: ReactNode;
  run: () => void;
}

export default function CommandPalette({
  onClose,
  projectKey,
  projects,
  theme,
  onToggleTheme,
}: {
  onClose: () => void;
  projectKey: string;
  projects: ProjectSummary[];
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}) {
  const navigate = useNavigate();
  const { recent: recentIssues, remember: rememberIssue } = useRecentIssues();
  const { recent: recentProjectKeys, remember: rememberProject } = useRecentProjects();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!query.trim()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .search(query.trim(), 20)
        .then((payload) => {
          if (cancelled) return;
          setResults(payload.items);
          setSearchError(null);
          setSelected(0);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setResults([]);
          setSearchError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  function close() {
    onClose();
  }

  function goToIssue(item: SearchResultItem) {
    rememberIssue({
      key: item.issue.key,
      title: item.issue.title,
      projectKey: item.project.key,
      projectName: item.project.name,
      stage: item.issue.stage,
    });
    navigate(`/projects/${item.project.key}/issues/${item.issue.key}`);
    close();
  }

  function goToProject(project: ProjectSummary | { key: string; name: string }) {
    rememberProject(project.key);
    navigate(`/projects/${project.key}/board`);
    close();
  }

  const term = query.trim().toLowerCase();

  const actionEntries: PaletteItem[] = [
    {
      id: 'action:new-issue',
      group: 'Actions',
      title: 'New Issue',
      subtitle: `in ${projectKey}`,
      icon: <Plus size={15} />,
      run: () => {
        navigate(`/projects/${projectKey}/board`, { state: { newIssue: true } });
        close();
      },
    },
    {
      id: 'action:board',
      group: 'Actions',
      title: 'Go to board',
      subtitle: projectKey,
      icon: <LayoutGrid size={15} />,
      run: () => {
        navigate(`/projects/${projectKey}/board`);
        close();
      },
    },
    {
      id: 'action:settings',
      group: 'Actions',
      title: 'Project settings',
      subtitle: projectKey,
      icon: <Settings size={15} />,
      run: () => {
        navigate(`/projects/${projectKey}/settings`);
        close();
      },
    },
    {
      id: 'action:theme',
      group: 'Actions',
      title: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      icon: theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />,
      run: () => {
        onToggleTheme();
        close();
      },
    },
  ];
  const actions = actionEntries.filter(
    (entry) => !term || entry.title.toLowerCase().includes(term),
  );

  const issueItems: PaletteItem[] = term
    ? results.map((result) => ({
        id: `issue:${result.issue.id}`,
        group: 'Issues',
        title: `${result.issue.key} — ${result.issue.title}`,
        subtitle: `${result.project.key} · ${result.project.name}`,
        badge: <span className="chip">{stageLabel(result.issue.stage)}</span>,
        icon: <ArrowRight size={15} />,
        run: () => goToIssue(result),
      }))
    : recentIssues.slice(0, 8).map((issue) => ({
        id: `issue:${issue.projectKey}:${issue.key}`,
        group: 'Issues',
        title: `${issue.key} — ${issue.title}`,
        subtitle: `${issue.projectKey} · ${issue.projectName}`,
        badge: <span className="chip">{stageLabel(issue.stage)}</span>,
        icon: <ArrowRight size={15} />,
        run: () => {
          rememberIssue({
            key: issue.key,
            title: issue.title,
            projectKey: issue.projectKey,
            projectName: issue.projectName,
            stage: issue.stage,
          });
          navigate(`/projects/${issue.projectKey}/issues/${issue.key}`);
          close();
        },
      }));

  const orderedProjects = term
    ? projects.filter(
        (project) =>
          project.key.toLowerCase().includes(term) ||
          project.name.toLowerCase().includes(term),
      )
    : [
        ...recentProjectKeys.flatMap((key) => {
          const project = projects.find((entry) => entry.key === key);
          return project ? [project] : [];
        }),
        ...projects.filter((project) => !recentProjectKeys.includes(project.key)),
      ];
  const uniqueProjects = orderedProjects.filter(
    (project, index) =>
      orderedProjects.findIndex((entry) => entry.id === project.id) === index,
  );
  const projectItems: PaletteItem[] = uniqueProjects
    .slice(0, term ? 8 : 6)
    .map((project) => ({
      id: `project:${project.id}`,
      group: 'Projects',
      title: `${project.key} — ${project.name}`,
      subtitle: `${project.counts.total} Issue${project.counts.total === 1 ? '' : 's'}`,
      icon: <FolderKanban size={15} />,
      run: () => goToProject(project),
    }));

  const items = [...actions, ...issueItems, ...projectItems];
  const activeIndex = items.length === 0 ? -1 : Math.min(selected, items.length - 1);

  function move(delta: number) {
    if (items.length === 0) return;
    setSelected((previous) => (previous + delta + items.length) % items.length);
  }

  let renderedGroup: Group | null = null;

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-[12vh] z-[80] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-subtle surface shadow-2xl"
          data-testid="command-palette"
          aria-label="Command palette"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search Issues across Projects, jump to a Project, or run an action.
          </Dialog.Description>
          <div className="flex items-center gap-2 border-b border-subtle px-3 py-2.5">
            <Search size={16} className="shrink-0 muted" />
            <input
              autoFocus
              className="w-full border-0 bg-transparent text-sm outline-none"
              placeholder="Search Issues, Projects, and actions…"
              value={query}
              onChange={(event) => {
                const value = event.target.value;
                setQuery(value);
                setSelected(0);
                setSearchError(null);
                if (value.trim()) {
                  setSearching(true);
                } else {
                  setSearching(false);
                  setResults([]);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  move(1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  move(-1);
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  items[activeIndex]?.run();
                }
              }}
              aria-label="Command palette search"
              data-testid="palette-input"
            />
            <span className="shrink-0 text-[10px] muted">
              {searching ? 'Searching…' : 'Esc to close'}
            </span>
          </div>

          <div className="scrollbar max-h-[55vh] overflow-y-auto p-1.5">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs muted">
                {searchError
                  ? `Search failed: ${searchError}`
                  : searching
                    ? 'Searching…'
                    : query.trim()
                      ? `No results for “${query.trim()}”.`
                      : 'Nothing to show yet.'}
              </p>
            ) : null}

            {items.map((item, index) => {
              const heading = item.group !== renderedGroup ? item.group : null;
              renderedGroup = item.group;
              return (
                <div key={item.id}>
                  {heading ? (
                    <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] muted">
                      {heading}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs ${
                      index === activeIndex
                        ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'hover:bg-[var(--surface-2)]'
                    }`}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => item.run()}
                    data-palette-item={item.id}
                  >
                    <span className="shrink-0 muted">{item.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.title}</span>
                      {item.subtitle ? (
                        <span className="block truncate text-[10px] muted">
                          {item.subtitle}
                        </span>
                      ) : null}
                    </span>
                    {item.badge}
                  </button>
                </div>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}