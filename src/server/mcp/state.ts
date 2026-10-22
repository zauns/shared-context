import type { AppConfig } from '../config.js';
import type { Database } from '../db/connection.js';
import type { ChangeBus } from '../services/change-bus.js';

export interface McpSessionState {
  actorId?: string;
  actorName?: string;
  defaultProjectId?: string;
  canReadImages: boolean;
}

export interface McpDeps {
  db: Database;
  config: AppConfig;
  bus: ChangeBus;
}
