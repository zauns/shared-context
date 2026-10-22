import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../../src/server/db/migrate.js';
import { identifyActor } from '../../src/server/domain/actors.js';
import { createProject } from '../../src/server/domain/projects.js';
import type { ActorRef, ProjectSummary } from '../../src/server/domain/types.js';

export function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

export interface TestSeed {
  project: ProjectSummary;
  owner: ActorRef;
  agent: ActorRef;
}

export function seedBase(db: DatabaseSync): TestSeed {
  const project = createProject(db, { key: 'SHC', name: 'Shared Context' });
  const owner = identifyActor(db, { name: 'Owner', kind: 'human' });
  const agent = identifyActor(db, { name: 'frontend-agent', kind: 'agent' });
  return { project, owner, agent };
}
