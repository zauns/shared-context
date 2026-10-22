import { describe, expect, it } from 'vitest';
import { createTestDb, seedBase } from '../helpers/db.js';
import {
  blockIssue,
  claimIssue,
  createIssue,
  deleteIssue,
  getBoard,
  getIssue,
  listIssues,
  moveIssue,
  releaseIssue,
  restoreIssue,
  unblockIssue,
  updateIssue,
} from '../../src/server/domain/issues.js';

describe('issues', () => {
  it('creates Issues with keys, defaults, and idempotency', () => {
    const db = createTestDb();
    const { project } = seedBase(db);
    const first = createIssue(db, {
      project: project.key,
      title: 'First issue',
      actor: 'Owner',
      client_request_id: 'create-1',
    });
    expect(first.issue.key).toBe('SHC-1');
    expect(first.issue.stage).toBe('backlog');
    expect(first.issue.priority).toBe('none');
    expect(first.issue.rev).toBe(1);

    const duplicate = createIssue(db, {
      project: project.key,
      title: 'Ignored duplicate',
      actor: 'Owner',
      client_request_id: 'create-1',
    });
    expect(duplicate.created).toBe(false);
    expect(duplicate.issue.key).toBe('SHC-1');

    const second = createIssue(db, { project: project.key, title: 'Second', actor: 'Owner' });
    expect(second.issue.key).toBe('SHC-2');
    db.close();
  });

  it('detects stale updates and writes Activity', () => {
    const db = createTestDb();
    const { project } = seedBase(db);
    const { issue } = createIssue(db, {
      project: project.key,
      title: 'Original',
      actor: 'Owner',
    });

    expect(() =>
      updateIssue(db, {
        issue: issue.key,
        expected_rev: 99,
        title: 'Stale',
        actor: 'Owner',
      }),
    ).toThrowError(/changed since revision/);

    const updated = updateIssue(db, {
      issue: issue.key,
      expected_rev: issue.rev,
      title: 'Updated',
      priority: 'high',
      actor: 'Owner',
    });
    expect(updated.changed).toBe(true);
    expect(updated.issue.title).toBe('Updated');
    expect(updated.issue.priority).toBe('high');
    expect(updated.issue.rev).toBe(2);
    expect(updated.issue.activity.length).toBeGreaterThan(0);
    db.close();
  });

  it('moves Issues and maintains completed/cancelled timestamps', () => {
    const db = createTestDb();
    const { project } = seedBase(db);
    const { issue } = createIssue(db, {
      project: project.key,
      title: 'Move me',
      actor: 'Owner',
    });
    const done = moveIssue(db, {
      issue: issue.key,
      expected_rev: issue.rev,
      stage: 'done',
      actor: 'Owner',
    });
    expect(done.issue.stage).toBe('done');
    expect(done.issue.completed_at).not.toBeNull();
    expect(done.issue.cancelled_at).toBeNull();

    const reopened = moveIssue(db, {
      issue: issue.key,
      expected_rev: done.issue.rev,
      stage: 'todo',
      actor: 'Owner',
    });
    expect(reopened.issue.completed_at).toBeNull();
    db.close();
  });

  it('blocks without changing Stage and unblocks', () => {
    const db = createTestDb();
    const { project } = seedBase(db);
    const { issue } = createIssue(db, {
      project: project.key,
      title: 'Blocked issue',
      stage: 'review',
      actor: 'Owner',
    });
    const blocked = blockIssue(db, {
      issue: issue.key,
      expected_rev: issue.rev,
      reason: 'Waiting on review',
      actor: 'Owner',
    });
    expect(blocked.issue.stage).toBe('review');
    expect(blocked.issue.blocked).toBe(true);
    expect(blocked.issue.blocked_reason).toBe('Waiting on review');

    const unblocked = unblockIssue(db, {
      issue: issue.key,
      expected_rev: blocked.issue.rev,
      actor: 'Owner',
    });
    expect(unblocked.issue.blocked).toBe(false);
    expect(unblocked.issue.stage).toBe('review');
    db.close();
  });

  it('claims atomically and releases only the owner or a human', () => {
    const db = createTestDb();
    const { project } = seedBase(db);
    const { issue } = createIssue(db, {
      project: project.key,
      title: 'Claim me',
      actor: 'Owner',
    });
    const claimed = claimIssue(db, { issue: issue.key, actor: 'frontend-agent' });
    expect(claimed.claimed).toBe(true);
    expect(claimed.issue.assignee?.name).toBe('frontend-agent');
    expect(claimed.issue.stage).toBe('in_progress');

    expect(() => claimIssue(db, { issue: issue.key, actor: 'Owner' })).toThrowError(
      /already assigned/,
    );
    const released = releaseIssue(db, { issue: issue.key, actor: 'frontend-agent' });
    expect(released.released).toBe(true);
    expect(released.issue.assignee).toBeNull();
    db.close();
  });

  it('computes child progress and rejects cycles', () => {
    const db = createTestDb();
    const { project } = seedBase(db);
    const parent = createIssue(db, {
      project: project.key,
      title: 'Parent',
      actor: 'Owner',
    }).issue;
    const child = createIssue(db, {
      project: project.key,
      title: 'Child',
      parent: parent.key,
      actor: 'Owner',
    }).issue;
    moveIssue(db, {
      issue: child.key,
      expected_rev: child.rev,
      stage: 'done',
      actor: 'Owner',
    });
    const detail = getIssue(db, parent.key);
    expect(detail.child_progress.done).toBe(1);
    expect(detail.child_progress.active).toBe(0);
    expect(detail.children).toHaveLength(1);

    expect(() =>
      updateIssue(db, {
        issue: parent.key,
        expected_rev: detail.rev,
        parent: child.key,
        actor: 'Owner',
      }),
    ).toThrowError(/cycle/);
    db.close();
  });

  it('soft-deletes a subtree and restores the batch', () => {
    const db = createTestDb();
    const { project } = seedBase(db);
    const parent = createIssue(db, {
      project: project.key,
      title: 'Parent',
      actor: 'Owner',
    }).issue;
    const child = createIssue(db, {
      project: project.key,
      title: 'Child',
      parent: parent.key,
      actor: 'Owner',
    }).issue;

    expect(() =>
      deleteIssue(db, {
        issue: parent.key,
        expected_rev: parent.rev,
        actor: 'Owner',
      }),
    ).toThrowError(/children/);

    const deleted = deleteIssue(db, {
      issue: parent.key,
      expected_rev: parent.rev,
      cascade: true,
      actor: 'Owner',
    });
    expect(deleted.deleted).toHaveLength(2);
    expect(() => getIssue(db, parent.key)).toThrowError(/not found/);
    expect(() => getIssue(db, child.key)).toThrowError(/not found/);

    const restored = restoreIssue(db, { issue: parent.key, actor: 'Owner' });
    expect(restored.restored).toHaveLength(2);
    expect(getIssue(db, parent.key).children).toHaveLength(1);
    db.close();
  });

  it('searches with FTS and filters the board', () => {
    const db = createTestDb();
    const { project } = seedBase(db);
    createIssue(db, {
      project: project.key,
      title: 'Unique searchable phrase',
      priority: 'urgent',
      actor: 'Owner',
    });
    createIssue(db, {
      project: project.key,
      title: 'Another issue',
      stage: 'todo',
      actor: 'Owner',
    });

    const search = listIssues(db, { project: project.key, q: 'searchable' });
    expect(search.items).toHaveLength(1);
    const filtered = listIssues(db, { project: project.key, priorities: ['urgent'] });
    expect(filtered.items).toHaveLength(1);
    const board = getBoard(db, { project: project.key });
    expect(board.columns).toHaveLength(6);
    expect(board.columns.find((column) => column.stage === 'backlog')?.count).toBe(1);
    db.close();
  });

  it('allocates 50 unique keys in one Project', () => {
    const db = createTestDb();
    const { project } = seedBase(db);
    const keys: string[] = [];
    for (let index = 0; index < 50; index += 1) {
      keys.push(
        createIssue(db, {
          project: project.key,
          title: `Issue ${index}`,
          actor: 'Owner',
        }).issue.key,
      );
    }
    expect(new Set(keys).size).toBe(50);
    expect(keys[0]).toBe('SHC-1');
    expect(keys[49]).toBe('SHC-50');
    db.close();
  });

  it('updates FTS and excludes soft-deleted Issues from search', () => {
    const db = createTestDb();
    const { project } = seedBase(db);
    const issue = createIssue(db, {
      project: project.key,
      title: 'Alpha phrase',
      actor: 'Owner',
    }).issue;

    expect(listIssues(db, { project: project.key, q: 'alpha' }).items).toHaveLength(1);
    const updated = updateIssue(db, {
      issue: issue.key,
      expected_rev: issue.rev,
      title: 'Beta phrase',
      actor: 'Owner',
    });
    expect(listIssues(db, { project: project.key, q: 'alpha' }).items).toHaveLength(0);
    expect(listIssues(db, { project: project.key, q: 'beta' }).items).toHaveLength(1);

    deleteIssue(db, {
      issue: issue.key,
      expected_rev: updated.issue.rev,
      actor: 'Owner',
    });
    expect(listIssues(db, { project: project.key, q: 'beta' }).items).toHaveLength(0);
    db.close();
  });
});
