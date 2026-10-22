import type { Database } from '../db/connection.js';
import { activityRowsAfter } from '../db/repositories/activities.js';
import { activityRowToEvent } from '../domain/activity.js';
import { DomainError } from '../domain/errors.js';
import type { ActivityEvent } from '../domain/types.js';

export type ChangeListener = (event: ActivityEvent) => void;

export class ChangeBus {
  private readonly listeners = new Set<ChangeListener>();

  publish(event: ActivityEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken SSE connection must not break the mutation path.
      }
    }
  }

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

export function publishActivitiesSince(
  db: Database,
  bus: ChangeBus,
  since: number,
): ActivityEvent[] {
  const rows = activityRowsAfter(db, since, undefined, 1000);
  const events = rows.map((row) => activityRowToEvent(db, row));
  for (const event of events) bus.publish(event);
  return events;
}

export interface WaitForChangeOptions {
  since: number;
  projectId?: string;
  timeoutMs: number;
}

export interface WaitForChangeResult {
  events: ActivityEvent[];
  cursor: number;
  timed_out: boolean;
}

export function waitForChange(
  db: Database,
  bus: ChangeBus,
  options: WaitForChangeOptions,
): Promise<WaitForChangeResult> {
  if (!Number.isInteger(options.since) || options.since < 0) {
    throw new DomainError('validation_error', 'since must be a non-negative integer');
  }
  const timeoutMs = Math.min(Math.max(options.timeoutMs, 1), 60_000);

  const read = (): ActivityEvent[] =>
    activityRowsAfter(db, options.since, options.projectId, 100).map((row) =>
      activityRowToEvent(db, row),
    );

  const existing = read();
  if (existing.length > 0) {
    return Promise.resolve({
      events: existing,
      cursor: existing[existing.length - 1]!.id,
      timed_out: false,
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};
    const timeout = { handle: undefined as NodeJS.Timeout | undefined };

    const finish = (events: ActivityEvent[], timedOut: boolean) => {
      if (settled) return;
      settled = true;
      if (timeout.handle) clearTimeout(timeout.handle);
      unsubscribe();
      resolve({
        events,
        cursor: events.length > 0 ? events[events.length - 1]!.id : options.since,
        timed_out: timedOut,
      });
    };

    unsubscribe = bus.subscribe((event) => {
      if (options.projectId && event.project_id !== options.projectId) return;
      if (event.id <= options.since) return;
      finish([event], false);
    });

    timeout.handle = setTimeout(() => finish([], true), timeoutMs);

    // Close the lost-wakeup window: an event may have committed between the
    // first read and the subscription.
    const afterSubscribe = read();
    if (afterSubscribe.length > 0) finish(afterSubscribe, false);
  });
}
