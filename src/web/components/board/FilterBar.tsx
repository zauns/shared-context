import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import {
  Ban,
  Bookmark,
  Check,
  ChevronDown,
  Eye,
  Paperclip,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { ActorRef, Module, Priority, Stage } from '../../api/types.js';
import { PRIORITIES, STAGES } from '../../api/types.js';
import type { FilterState } from '../../lib/filters.js';
import { DEFAULT_FILTERS, activeFilterCount } from '../../lib/filters.js';
import { priorityLabel, stageLabel } from '../../lib/board.js';
import { useSavedViews } from '../../state/local.js';

function MultiSelect<T extends string>({
  label,
  options,
  selected,
  onToggle,
  onClear,
  render,
}: {
  label: string;
  options: T[];
  selected: T[];
  onToggle: (value: T) => void;
  onClear: () => void;
  render: (value: T) => string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`btn ${selected.length > 0 ? 'chip-active' : ''}`}
        >
          {label}
          {selected.length > 0 ? ` (${selected.length})` : ''}
          <ChevronDown size={12} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="start"
          className="z-[70] w-52 rounded-lg border border-subtle surface p-1.5 shadow-2xl"
        >
          <div className="max-h-64 overflow-y-auto">
            {options.map((option) => {
              const checked = selected.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--surface-2)]"
                  onClick={() => onToggle(option)}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded border ${
                      checked
                        ? 'border-[var(--accent)] bg-[var(--accent)] text-[#041016]'
                        : 'border-[var(--border-strong)]'
                    }`}
                  >
                    {checked ? <Check size={11} /> : null}
                  </span>
                  {render(option)}
                </button>
              );
            })}
          </div>
          {selected.length > 0 ? (
            <button
              type="button"
              className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-[11px] muted hover:bg-[var(--surface-2)]"
              onClick={onClear}
            >
              Clear {label.toLowerCase()}
            </button>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SavedViews({
  projectKey,
  filters,
  onApply,
}: {
  projectKey: string;
  filters: FilterState;
  onApply: (filters: FilterState) => void;
}) {
  const { views, save, remove } = useSavedViews(projectKey);
  const [name, setName] = useState('');

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="btn">
          <Bookmark size={13} />
          Saved
          {views.length > 0 ? ` (${views.length})` : ''}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="end"
          className="z-[70] w-72 rounded-lg border border-subtle surface p-2 shadow-2xl"
        >
          <div className="flex gap-1.5">
            <input
              className="input"
              placeholder="Name this view"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && name.trim()) {
                  save(name.trim(), filters);
                  setName('');
                }
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!name.trim()}
              onClick={() => {
                save(name.trim(), filters);
                setName('');
              }}
            >
              Save
            </button>
          </div>
          <div className="mt-2 max-h-60 space-y-1 overflow-y-auto">
            {views.length === 0 ? (
              <p className="px-2 py-2 text-[11px] muted">No saved views yet.</p>
            ) : (
              views.map((view) => (
                <div key={view.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--surface-2)]"
                    onClick={() => onApply(view.filters)}
                  >
                    {view.name}
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon btn-ghost"
                    onClick={() => remove(view.id)}
                    aria-label={`Delete saved view ${view.name}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default function FilterBar({
  projectKey,
  filters,
  onChange,
  modules,
  actors,
}: {
  projectKey: string;
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  modules: Module[];
  actors: ActorRef[];
}) {
  const update = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });
  const selectedPriorities = filters.priorities.length > 0 ? filters.priorities : PRIORITIES;
  const selectedStages = filters.stages.length > 0 ? filters.stages : STAGES;
  const activeCount = activeFilterCount(filters);

  const togglePriority = (priority: Priority) => {
    const next = selectedPriorities.includes(priority)
      ? selectedPriorities.filter((entry) => entry !== priority)
      : [...selectedPriorities, priority];
    update({ priorities: next.length === PRIORITIES.length ? [] : next });
  };

  const toggleStage = (stage: Stage) => {
    if (selectedStages.length === 1 && selectedStages[0] === stage) return;
    const next = selectedStages.includes(stage)
      ? selectedStages.filter((entry) => entry !== stage)
      : [...selectedStages, stage];
    update({ stages: next.length === STAGES.length ? [] : next });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-subtle px-4 py-2 surface">
      <div className="relative w-56">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 muted" />
        <input
          className="input pl-8 pr-7"
          placeholder="Search Issues…"
          value={filters.q}
          onChange={(event) => update({ q: event.target.value })}
          aria-label="Search Issues"
        />
        {filters.q ? (
          <button
            type="button"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 muted hover:text-[var(--text)]"
            onClick={() => update({ q: '' })}
            aria-label="Clear search"
          >
            <X size={12} />
          </button>
        ) : null}
      </div>

      <MultiSelect
        label="Priority"
        options={PRIORITIES}
        selected={selectedPriorities}
        onToggle={togglePriority}
        onClear={() => update({ priorities: [] })}
        render={priorityLabel}
      />
      <MultiSelect
        label="Stages"
        options={STAGES}
        selected={selectedStages}
        onToggle={toggleStage}
        onClear={() => update({ stages: [] })}
        render={stageLabel}
      />

      <select
        className="select w-auto min-w-[140px]"
        value={filters.assignee}
        onChange={(event) => update({ assignee: event.target.value })}
        aria-label="Filter by Assignee"
      >
        <option value="">All assignees</option>
        {actors.map((actor) => (
          <option key={actor.id} value={actor.name}>
            {actor.name}
          </option>
        ))}
      </select>

      <select
        className="select w-auto min-w-[130px]"
        value={filters.module}
        onChange={(event) => update({ module: event.target.value })}
        aria-label="Filter by Module"
      >
        <option value="">All modules</option>
        {modules.map((module) => (
          <option key={module.id} value={module.slug}>
            {module.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        className={`btn ${filters.blocked ? 'chip-active' : ''}`}
        onClick={() => update({ blocked: !filters.blocked })}
        aria-pressed={filters.blocked}
      >
        <Ban size={13} />
        Blocked
      </button>
      <button
        type="button"
        className={`btn ${filters.hasAttachments ? 'chip-active' : ''}`}
        onClick={() => update({ hasAttachments: !filters.hasAttachments })}
        aria-pressed={filters.hasAttachments}
      >
        <Paperclip size={13} />
        Files
      </button>
      <button
        type="button"
        className={`btn ${filters.includeClosed ? 'chip-active' : ''}`}
        onClick={() => update({ includeClosed: !filters.includeClosed })}
        aria-pressed={filters.includeClosed}
      >
        <Eye size={13} />
        Closed
      </button>

      <SavedViews projectKey={projectKey} filters={filters} onApply={onChange} />

      <div className="ml-auto flex items-center gap-2">
        <span className="text-[10px] muted">
          {activeCount === 0 ? 'No filters' : `${activeCount} filter${activeCount === 1 ? '' : 's'}`}
        </span>
        {activeCount > 0 ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onChange({ ...DEFAULT_FILTERS })}
          >
            <X size={13} />
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
