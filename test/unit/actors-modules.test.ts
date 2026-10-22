import { describe, expect, it } from 'vitest';
import { createTestDb, seedBase } from '../helpers/db.js';
import { identifyActor, listActors, updateActor } from '../../src/server/domain/actors.js';
import {
  createModule,
  deleteModule,
  listModules,
  updateModule,
} from '../../src/server/domain/modules.js';
import { createIssue } from '../../src/server/domain/issues.js';

describe('actors', () => {
  it('identifies case-insensitively and updates capabilities', () => {
    const db = createTestDb();
    const first = identifyActor(db, { name: 'Frontend Agent', kind: 'agent' });
    const second = identifyActor(db, {
      name: 'frontend agent',
      can_read_images: true,
    });
    expect(second.id).toBe(first.id);
    expect(second.can_read_images).toBe(true);
    expect(listActors(db)).toHaveLength(1);
    db.close();
  });

  it('renames an actor and keeps the name unique', () => {
    const db = createTestDb();
    const first = identifyActor(db, { name: 'one' });
    identifyActor(db, { name: 'two' });
    const renamed = updateActor(db, first.id, { name: 'three' });
    expect(renamed.name).toBe('three');
    expect(() => updateActor(db, first.id, { name: 'two' })).toThrowError(/already in use/);
    db.close();
  });
});

describe('modules', () => {
  it('slugifies, reuses, renames, and refuses to delete an in-use module', () => {
    const db = createTestDb();
    const { project } = seedBase(db);
    const created = createModule(db, { project: project.key, name: 'Frontend Refactor' });
    expect(created.created).toBe(true);
    expect(created.module.slug).toBe('frontend-refactor');
    const duplicate = createModule(db, { project: project.key, name: 'frontend refactor' });
    expect(duplicate.created).toBe(false);
    expect(duplicate.module.id).toBe(created.module.id);
    expect(listModules(db, project.key)).toHaveLength(1);

    const renamed = updateModule(db, created.module.id, { name: 'Frontend Work' });
    expect(renamed.slug).toBe('frontend-refactor');
    expect(renamed.name).toBe('Frontend Work');

    createIssue(db, {
      project: project.key,
      title: 'Use the module',
      module: created.module.slug,
      actor: 'Owner',
    });
    expect(() => deleteModule(db, created.module.id)).toThrowError(/used by active Issues/);
    db.close();
  });
});
