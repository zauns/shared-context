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
