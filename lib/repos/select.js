/**
 * Repo selection: which repos a command operates on.
 */
import path from 'node:path';
import {pathExists} from '../util/fs.js';
import PQueue from 'p-queue';
import {spawnProcess} from '../run/exec.js';
import {UsageError} from '../errors.js';

/**
 * @typedef {object} Selection
 * @property {string[]} [groups] - Group ids (comma separated values allowed).
 * @property {string[]} [tags] - Tag expressions. Values are ORed; within a
 *   value `,` is OR, `+` is AND, and a leading `!` negates.
 * @property {string[]} [repos] - Repo names or globs; `.` is the repo
 *   containing `cwd`.
 * @property {string[]} [exclude] - Repo names or globs to exclude.
 * @property {boolean} [all] - Include disabled repos and groups.
 * @property {string} [from] - Skip repos before this one.
 * @property {'missing'|'cloned'|'dirty'} [state] - Filter by checkout
 *   state. `dirty` means cloned with uncommitted changes or untracked
 *   files (anything `git status --porcelain` reports).
 */

/**
 * Select repos from a workspace.
 *
 * By default all enabled repos in enabled groups are selected. A disabled
 * repo named exactly, or an enabled repo in a disabled group that is named
 * with `groups`, is included with a notice.
 *
 * @param {import('../workspace/load.js').Workspace} workspace - Workspace.
 * @param {Selection} [selection] - Selection options.
 * @param {object} [options] - Options.
 * @param {string} [options.cwd] - Current directory, for `.`.
 * @param {number} [options.jobs] - Concurrency for the `dirty` check.
 * @param {object} [options.env] - Environment for git.
 *
 * @returns {Promise<{repos: object[], notices: string[]}>} Selected repos in
 *   workspace order, and notices for the user.
 */
export async function selectRepos(workspace, selection = {}, {
  cwd = process.cwd(), jobs = 8, env = process.env
} = {}) {
  const notices = [];
  const groupIds = splitList(selection.groups);
  const repoPatterns = splitList(selection.repos);
  const excludePatterns = splitList(selection.exclude);
  const tagExpressions = (selection.tags ?? []).map(parseTagExpression);

  const knownGroups = new Set(workspace.groups.map(g => g.id));
  for(const id of groupIds) {
    if(!knownGroups.has(id)) {
      throw new UsageError(`Unknown group "${id}".`, {
        details: [`Known groups: ${[...knownGroups].join(', ') || '(none)'}`]
      });
    }
  }
  const groupSet = new Set(groupIds);

  const explicitNames = new Set();
  const includeMatchers = repoPatterns.map(pattern => createMatcher({
    pattern, workspace, cwd, explicitNames
  }));
  const excludeMatchers = excludePatterns.map(pattern => createMatcher({
    pattern, workspace, cwd
  }));

  const knownTags = new Set(workspace.repos.flatMap(r => r.tags));
  for(const tag of tagExpressions.flat(2).map(a => a.tag)) {
    if(!knownTags.has(tag)) {
      notices.push(`Tag "${tag}" is not used by any repo.`);
    }
  }

  let repos = workspace.repos;
  if(groupSet.size > 0) {
    repos = repos.filter(r => groupSet.has(r.group));
  }
  if(includeMatchers.length > 0) {
    repos = repos.filter(r => includeMatchers.some(m => m(r)));
  }
  if(tagExpressions.length > 0) {
    repos = repos.filter(r => tagExpressions.some(e => matchTags(e, r)));
  }
  if(!selection.all) {
    repos = repos.filter(r => {
      if(r.enabled) {
        return true;
      }
      if(explicitNames.has(r.name)) {
        notices.push(`Including disabled repo "${r.name}" (named ` +
          'explicitly).');
        return true;
      }
      if(r.repoEnabled && groupSet.has(r.group)) {
        return true;
      }
      return false;
    });
    const disabledGroups = workspace.groups
      .filter(g => !g.enabled && groupSet.has(g.id));
    for(const group of disabledGroups) {
      notices.push(`Including disabled group "${group.id}" (named ` +
        'explicitly).');
    }
  }
  if(excludeMatchers.length > 0) {
    repos = repos.filter(r => !excludeMatchers.some(m => m(r)));
  }
  if(selection.from) {
    const start = workspace.repos.find(r => r.name === selection.from);
    if(!start) {
      throw new UsageError(`Unknown repo "${selection.from}" for --from.`);
    }
    repos = repos.filter(r => r.index >= start.index);
  }
  if(selection.state) {
    repos = await filterByState(repos, selection.state, {jobs, env});
  }
  return {repos, notices};
}

/**
 * Check whether a repo is checked out.
 *
 * @param {object} repo - Repo.
 *
 * @returns {Promise<boolean>} True if `<path>/.git` exists.
 */
export function isCloned(repo) {
  return pathExists(path.join(repo.path, '.git'));
}

/**
 * Check whether a cloned repo has uncommitted changes or untracked files.
 * Repos whose status can not be read count as dirty, so commands still
 * visit (and report) them.
 *
 * @param {object} repo - Repo.
 * @param {object} [options] - Options.
 * @param {object} [options.env] - Environment.
 *
 * @returns {Promise<boolean>} True if dirty.
 */
export async function isDirty(repo, {env = process.env} = {}) {
  try {
    const result = await spawnProcess('git', ['status', '--porcelain'],
      {cwd: repo.path, env});
    return result.code !== 0 || result.stdout.length > 0;
  } catch {
    return true;
  }
}

async function filterByState(repos, state, {jobs, env}) {
  const cloned = await Promise.all(repos.map(isCloned));
  if(state === 'missing') {
    return repos.filter((r, i) => !cloned[i]);
  }
  const clonedRepos = repos.filter((r, i) => cloned[i]);
  if(state === 'cloned') {
    return clonedRepos;
  }
  const queue = new PQueue({concurrency: jobs});
  const dirty = await Promise.all(clonedRepos.map(
    repo => queue.add(() => isDirty(repo, {env}))));
  return clonedRepos.filter((r, i) => dirty[i]);
}

function splitList(values = []) {
  return values.flatMap(v => v.split(',')).map(v => v.trim()).filter(Boolean);
}

function createMatcher({pattern, workspace, cwd, explicitNames}) {
  if(pattern === '.') {
    const here = path.resolve(cwd);
    const repo = workspace.repos.find(r =>
      here === r.path || here.startsWith(r.path + path.sep));
    if(!repo) {
      throw new UsageError(`"." used but "${cwd}" is not inside a ` +
        'configured repo.');
    }
    explicitNames?.add(repo.name);
    return r => r === repo;
  }
  if(!/[*?[]/.test(pattern)) {
    if(!workspace.repos.some(r => r.name === pattern)) {
      throw new UsageError(`Unknown repo "${pattern}".`);
    }
    explicitNames?.add(pattern);
    return r => r.name === pattern;
  }
  const regex = globToRegExp(pattern);
  if(!workspace.repos.some(r => regex.test(r.name))) {
    throw new UsageError(`No repos match "${pattern}".`);
  }
  return r => regex.test(r.name);
}

/**
 * Convert a simple glob (`*`, `?`, `[...]`) to a regular expression.
 *
 * @param {string} glob - Glob pattern.
 *
 * @returns {RegExp} Anchored regular expression.
 */
export function globToRegExp(glob) {
  let source = '';
  for(let i = 0; i < glob.length; ++i) {
    const c = glob[i];
    if(c === '*') {
      source += '.*';
    } else if(c === '?') {
      source += '.';
    } else if(c === '[') {
      const end = glob.indexOf(']', i + 1);
      if(end === -1) {
        source += '\\[';
      } else {
        let set = glob.slice(i + 1, end).replace(/\\/g, '\\\\');
        if(set.startsWith('!')) {
          set = '^' + set.slice(1);
        }
        source += `[${set}]`;
        i = end;
      }
    } else {
      source += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * Parse a tag expression into OR-of-AND form.
 *
 * @param {string} expression - E.g. `a,b+!c`.
 *
 * @returns {Array<Array<{tag: string, negate: boolean}>>} Terms.
 */
export function parseTagExpression(expression) {
  const terms = expression.split(',').map(t => t.trim()).filter(Boolean);
  if(terms.length === 0) {
    throw new UsageError(`Invalid tag expression "${expression}".`);
  }
  return terms.map(term => term.split('+').map(atom => {
    atom = atom.trim();
    const negate = atom.startsWith('!');
    const tag = negate ? atom.slice(1) : atom;
    if(!tag) {
      throw new UsageError(`Invalid tag expression "${expression}".`);
    }
    return {tag, negate};
  }));
}

function matchTags(expression, repo) {
  return expression.some(term => term.every(
    ({tag, negate}) => repo.tags.includes(tag) !== negate));
}
