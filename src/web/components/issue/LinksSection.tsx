import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link2, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../api/client.js';
import type { IssueDetail, Link } from '../../api/types.js';
import { useToast } from '../common/Toast.js';

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function LinksSection({ issue }: { issue: IssueDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['issue', issue.key] });
  }

  async function addLink() {
    const trimmed = url.trim();
    if (!isHttpUrl(trimmed)) {
      setError('Enter an http or https URL.');
      return;
    }
    setError(null);
    setAdding(true);
    try {
      await api.addLink(issue.key, {
        url: trimmed,
        label: label.trim() || null,
      });
      setUrl('');
      setLabel('');
      await refresh();
      toast.push('Link added.', 'success');
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'Could not add the link';
      setError(message);
      toast.push(message, 'error');
    } finally {
      setAdding(false);
    }
  }

  async function removeLink(link: Link) {
    setRemovingId(link.id);
    try {
      await api.removeLink(link.id);
      setConfirmId(null);
      await refresh();
      toast.push('Link removed.', 'success');
    } catch (cause) {
      toast.push(
        cause instanceof ApiError ? cause.message : 'Could not remove the link',
        'error',
      );
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section data-testid="links-section">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] muted">
        <Link2 size={12} /> Links
        <span className="chip">{issue.links.length}</span>
      </h3>

      <div className="space-y-1">
        {issue.links.map((link) => (
          <div
            key={link.id}
            className="flex items-center gap-2 rounded-md border border-subtle px-2 py-1.5 text-xs"
          >
            <Link2 size={12} className="shrink-0 muted" />
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate hover:text-[var(--accent)]"
              title={link.url}
            >
              {link.label ?? link.url}
            </a>
            <button
              type="button"
              className="btn btn-ghost shrink-0 px-1.5 py-0.5 text-[var(--danger)]"
              onClick={() => setConfirmId(link.id)}
              aria-label={`Remove link ${link.label ?? link.url}`}
              title="Remove link"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {issue.links.length === 0 ? (
          <p className="text-xs muted">No links.</p>
        ) : null}
      </div>

      {confirmId ? (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-[var(--danger)] p-2 text-[11px]">
          <span>Remove this link?</span>
          <button
            type="button"
            className="btn btn-danger px-2 py-0.5"
            onClick={() => {
              const link = issue.links.find((entry) => entry.id === confirmId);
              if (link) void removeLink(link);
            }}
            disabled={removingId !== null}
          >
            Remove
          </button>
          <button
            type="button"
            className="btn btn-ghost px-2 py-0.5"
            onClick={() => setConfirmId(null)}
          >
            Cancel
          </button>
        </div>
      ) : null}

      <div className="mt-2 space-y-1.5">
        <input
          className="input"
          placeholder="https://example.com/spec"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void addLink();
          }}
          aria-label="Link URL"
        />
        <div className="flex gap-1.5">
          <input
            className="input"
            placeholder="Label (optional)"
            value={label}
            maxLength={200}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void addLink();
            }}
            aria-label="Link label"
          />
          <button
            type="button"
            className="btn shrink-0"
            onClick={() => void addLink()}
            disabled={adding || !url.trim()}
          >
            <Plus size={13} />
            Add link
          </button>
        </div>
        {error ? <p className="text-[11px] text-[var(--danger)]">{error}</p> : null}
      </div>
    </section>
  );
}