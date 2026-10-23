import type { Database } from '../db/connection.js';
import { currentActivityCursor } from '../db/repositories/activities.js';
import { publishActivitiesSince, type ChangeBus } from './change-bus.js';

export function mutateWithPublish<T>(
  db: Database,
  bus: ChangeBus,
  mutate: () => T,
): T {
  const before = currentActivityCursor(db);
  const result = mutate();
  publishActivitiesSince(db, bus, before);
  return result;
}

/**
 * Async counterpart for work that must finish outside the synchronous SQLite
 * transaction before change events are published (attachment copy/extraction).
 */
export async function mutateAsyncWithPublish<T>(
  db: Database,
  bus: ChangeBus,
  mutate: () => Promise<T>,
): Promise<T> {
  const before = currentActivityCursor(db);
  const result = await mutate();
  publishActivitiesSince(db, bus, before);
  return result;
}
