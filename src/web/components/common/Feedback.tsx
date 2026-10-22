import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
      {label}
    </div>
  );
}

export function FullPageSpinner({ label = 'Loading Shared Context…' }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center app-bg">
      <Spinner label={label} />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <Inbox size={28} className="muted" />
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-sm text-xs muted">{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <AlertTriangle size={28} className="text-[var(--danger)]" />
      <p className="text-sm font-medium">{title}</p>
      {message ? <p className="max-w-md text-xs muted">{message}</p> : null}
      {onRetry ? (
        <button type="button" className="btn mt-1" onClick={onRetry}>
          <RefreshCw size={14} />
          Retry
        </button>
      ) : null}
    </div>
  );
}
