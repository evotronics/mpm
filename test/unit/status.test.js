import {describe, expect, it} from 'vitest';
import {isInteresting} from '../../lib/commands/status.js';
import {parseStatus} from '../../lib/git/status.js';

describe('parseStatus', () => {
  it('parses branch headers and entries', () => {
    const text = [
      '# branch.oid 1234567890abcdef',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -3',
      '# stash 1',
      '1 M. N... 100644 100644 100644 a b staged.js',
      '1 .M N... 100644 100644 100644 a b modified.js',
      '1 MM N... 100644 100644 100644 a b both.js',
      '2 R. N... 100644 100644 100644 a b R100 new.js',
      'old.js',
      'u UU N... 100644 100644 100644 100644 a b c conflict.js',
      '? untracked.js',
      '? other.js',
      ''
    ].join('\0');
    expect(parseStatus(text)).toEqual({
      branch: 'main',
      detached: false,
      oid: '1234567890abcdef',
      upstream: 'origin/main',
      ahead: 2,
      behind: 3,
      staged: 3,
      modified: 2,
      unmerged: 1,
      untracked: 2,
      stash: 1,
      dirty: true
    });
  });

  it('parses detached and unborn states', () => {
    const detached = parseStatus(
      '# branch.oid abc\0# branch.head (detached)\0');
    expect(detached.detached).toBe(true);
    expect(detached.branch).toBe(null);
    const unborn = parseStatus(
      '# branch.oid (initial)\0# branch.head main\0');
    expect(unborn.oid).toBe(null);
    expect(unborn.dirty).toBe(false);
  });
});

describe('isInteresting', () => {
  const clean = {
    branch: 'main', defaultBranch: 'main', upstream: 'origin/main',
    detached: false, dirty: false, untracked: 0, stash: 0, ahead: 0,
    behind: 0
  };

  it('hides clean repos on their default branch', () => {
    expect(isInteresting(clean)).toBe(false);
    expect(isInteresting({...clean, defaultBranch: null})).toBe(false);
  });

  it('shows repos needing attention', () => {
    expect(isInteresting({...clean, dirty: true})).toBe(true);
    expect(isInteresting({...clean, untracked: 1})).toBe(true);
    expect(isInteresting({...clean, behind: 1})).toBe(true);
    expect(isInteresting({...clean, branch: 'feature'})).toBe(true);
    expect(isInteresting({...clean, upstream: null})).toBe(true);
    expect(isInteresting({...clean, stash: 1})).toBe(true);
  });
});
