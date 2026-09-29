/**
 * Git status helpers.
 */

/**
 * @typedef {object} GitStatus
 * @property {string|null} branch - Current branch, null if detached.
 * @property {boolean} detached - True if HEAD is detached.
 * @property {string|null} oid - HEAD commit, null for an unborn branch.
 * @property {string|null} upstream - Upstream branch, if any.
 * @property {number} ahead - Commits ahead of upstream.
 * @property {number} behind - Commits behind upstream.
 * @property {number} staged - Changed entries in the index.
 * @property {number} modified - Changed entries in the worktree.
 * @property {number} unmerged - Unmerged entries.
 * @property {number} untracked - Untracked files.
 * @property {number} stash - Stash entries.
 * @property {boolean} dirty - Staged, modified, or unmerged changes.
 */

/**
 * Parse `git status --porcelain=v2 --branch --show-stash -z` output.
 *
 * @param {string} text - Command output.
 *
 * @returns {GitStatus} Parsed status.
 */
export function parseStatus(text) {
  const status = {
    branch: null,
    detached: false,
    oid: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    unmerged: 0,
    untracked: 0,
    stash: 0
  };
  const entries = text.split('\0');
  for(let i = 0; i < entries.length; ++i) {
    const entry = entries[i];
    if(entry.startsWith('# ')) {
      const [key, ...rest] = entry.slice(2).split(' ');
      const value = rest.join(' ');
      switch(key) {
        case 'branch.oid':
          status.oid = value === '(initial)' ? null : value;
          break;
        case 'branch.head':
          if(value === '(detached)') {
            status.detached = true;
          } else {
            status.branch = value;
          }
          break;
        case 'branch.upstream':
          status.upstream = value;
          break;
        case 'branch.ab': {
          const match = value.match(/^\+(\d+) -(\d+)$/);
          if(match) {
            status.ahead = Number(match[1]);
            status.behind = Number(match[2]);
          }
          break;
        }
        case 'stash':
          status.stash = Number(value) || 0;
          break;
      }
    } else if(entry.startsWith('1 ') || entry.startsWith('2 ')) {
      const [x, y] = entry.slice(2, 4);
      if(x !== '.') {
        status.staged++;
      }
      if(y !== '.') {
        status.modified++;
      }
      if(entry.startsWith('2 ')) {
        // renamed/copied entries are followed by the original path
        i++;
      }
    } else if(entry.startsWith('u ')) {
      status.unmerged++;
    } else if(entry.startsWith('? ')) {
      status.untracked++;
    }
  }
  status.dirty = status.staged + status.modified + status.unmerged > 0;
  return status;
}

/**
 * Get the status of a repo.
 *
 * @param {object} context - Repo context from the runner.
 *
 * @returns {Promise<GitStatus & {defaultBranch: string|null}>} Status.
 */
export async function getStatus(context) {
  const [statusResult, headResult] = await Promise.all([
    context.run('git', [
      'status', '--porcelain=v2', '--branch', '--show-stash', '-z'
    ]),
    context.run('git', [
      'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'
    ], {allowExitCodes: [0, 1, 128]})
  ]);
  const status = parseStatus(statusResult.stdout);
  const originHead = headResult.code === 0 ? headResult.stdout.trim() : '';
  status.defaultBranch = originHead ?
    originHead.replace(/^[^/]+\//, '') : null;
  return status;
}

/**
 * Get the current HEAD commit.
 *
 * @param {object} context - Repo context from the runner.
 *
 * @returns {Promise<string|null>} Commit id, or null if unborn.
 */
export async function getHead(context) {
  const result = await context.run('git', ['rev-parse', '--verify', '-q',
    'HEAD'], {allowExitCodes: [0, 1]});
  return result.code === 0 ? result.stdout.trim() : null;
}
