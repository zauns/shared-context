import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/db.js';
import { createProject, deleteProject, getProject, listProjects } from '../../src/server/domain/projects.js';
import { createIssue } from '../../src/server/domain/issues.js';
import { identifyActor } from '../../src/server/domain/actors.js';

describe('projects', () => {
  it('creates, lists, and reads a project', () => {
    const db = createTestDb();
    const project = createProject(db, {
      key: 'shc',
      name: 'Shared Context',
      description: 'A tracker',
    });
    expect(project.key).toBe('SHC');
    expect(project.counts.total).toBe(0);
    expect(listProjects(db)).toHaveLength(1);
    expect(getProject(db, 'SHC').name).toBe('Shared Context');
    db.close();
  });

  it('rejects invalid keys and duplicate keys', () => {
    const db = createTestDb();
    createProject(db, { key: 'SHC', name: 'Shared Context' });
    expect(() => createProject(db, { key: '1BAD', name: 'Bad' })).toThrowError(
      /Project key/,
    );
    expect(() => createProject(db, { key: 'SHC', name: 'Duplicate' })).toThrowError(
      /already exists/,
    );
    db.close();
  });

  it('refuses to delete a project that still has Issues', () => {
    const db = createTestDb();
    const project = createProject(db, { key: 'SHC', name: 'Shared Context' });
    const agent = identifyActor(db, { name: 'agent' });
    createIssue(db, { project: project.key, title: 'Keep me', actor: agent.name });
    expect(() => deleteProject(db, project.key)).toThrowError(/still contains Issues/);
    db.close();
  });

  it('deletes an empty project', () => {
    const db = createTestDb();
    createProject(db, { key: 'SHC', name: 'Shared Context' });
    deleteProject(db, 'SHC');
    expect(listProjects(db)).toHaveLength(0);
    db.close();
  });
});
