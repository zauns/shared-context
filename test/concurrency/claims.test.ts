import { describe, expect, it } from 'vitest';
import { createTestDb, seedBase } from '../helpers/db.js';
import { claimIssue, createIssue, updateIssue } from '../../src/server/domain/issues.js';

describe('concurrency invariants', () => {
  it('allows exactly one claim winner', () => {
    const db = createTestDb();
    const { project } = seedBase(db);
    const issue = createIssue(db, {
      project: project.key,
      title: 'One owner',
      actor: 'Owner',
    }).issue;

    const first = claimIssue(db, { issue: issue.key, actor: 'frontend-agent' });
    expect(first.claimed).toBe(true);
    expect(() => claimIssue(db, { issue: issue.key, actor: 'Owner' })).toThrowError(
      /already assigned/,
    );
    db.close();
  });

  it('rejects the second write at the same revision', () => {
    const db = createTestDb();
    const { project } = seedBase(db);
    const issue = createIssue(db, {
      project: project.key,
      title: 'One writer',
      actor: 'Owner',
    }).issue;

    const first = updateIssue(db, {
      issue: issue.key,
      expected_rev: issue.rev,
      title: 'Winner',
      actor: 'Owner',
    });
    expect(first.changed).toBe(true);
    expect(() =>
      updateIssue(db, {
        issue: issue.key,
        expected_rev: issue.rev,
        title: 'Loser',
        actor: 'frontend-agent',
      }),
    ).toThrowError(/changed since revision/);
    db.close();
  });
});
