import { useEffect, useState } from 'react';

interface Health {
  ok: boolean;
  version: string;
  uptime_seconds: number;
  db: { open: boolean; journal_mode: string };
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/healthz')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<Health>;
      })
      .then(setHealth)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 px-8 py-12 text-slate-100">
      <div className="mx-auto max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-400">
          Shared Context
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Local issue tracker for agents</h1>
        <p className="mt-4 text-slate-400">
          Implementation scaffold. The board, drawer, and MCP tools arrive in later milestones.
        </p>
        <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-sm font-medium text-slate-300">Daemon status</h2>
          {error ? (
            <p className="mt-2 text-sm text-rose-400">Cannot reach /healthz: {error}</p>
          ) : health ? (
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <dt className="text-slate-500">Version</dt>
              <dd>{health.version}</dd>
              <dt className="text-slate-500">Uptime</dt>
              <dd>{Math.round(health.uptime_seconds)}s</dd>
              <dt className="text-slate-500">Database</dt>
              <dd>{health.db.open ? 'open' : 'closed'}</dd>
              <dt className="text-slate-500">Journal</dt>
              <dd>{health.db.journal_mode}</dd>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Checking…</p>
          )}
        </section>
      </div>
    </main>
  );
}
