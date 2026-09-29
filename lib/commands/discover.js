/**
 * `mpm discover`: find repos in a group's GitHub owner that are not in the
 * config yet, using the GitHub CLI (`gh`).
 */
import {EXIT, ExecError, UsageError} from '../errors.js';
import {githubOwner, urlKey} from '../repos/source.js';
import {insertEntry, newEntry} from '../config/repos.js';
import {cloneTask, default as clone} from './clone.js';
import {editText, applyEdit} from './edit-output.js';
import {errorSummary} from '../run/runner.js';
import PQueue from 'p-queue';
import {spawnProcess} from '../run/exec.js';

const GH_FIELDS = 'name,description,isArchived,isFork,url';
const collect = (value, previous = []) => [...previous, value];

export default {
  name: 'discover',
  helpGroup: 'Workspace and config commands:',
  summary: 'Find GitHub repos not yet in the config (uses gh)',
  description: 'List the repos of each group\'s GitHub owner (a group ' +
    'source like github:owner) and compare them with the whole workspace. ' +
    'Reports new repos, name conflicts, configured repos that no longer ' +
    'exist upstream, and repos archived upstream but still enabled here. ' +
    'Archived repos and forks are not offered as new unless --archived or ' +
    '--forks is given.\n\n' +
    'With --add, new repos are added to their group (use --dry-run to see ' +
    'the diff first); --clone also clones them.\n\n' +
    'Requires the GitHub CLI (https://cli.github.com), logged in with ' +
    '`gh auth login` for private repos.\n\n' +
    'Examples:\n' +
    '  mpm discover\n' +
    '  mpm -n discover core --add\n' +
    '  mpm discover core --clone -t new',
  arguments: [{name: '[groups...]', description: 'group ids (default: all ' +
    'enabled groups with a GitHub source)', complete: 'groups'}],
  options: [
    {flags: '--add', description: 'add new repos to their group'},
    {flags: '--clone', description: 'add new repos and clone them'},
    {flags: '--disabled', description: 'add new repos as disabled'},
    {flags: '-t, --tag <tag>', description: 'tag for added repos ' +
      '(repeatable)', parser: collect},
    {flags: '--archived', description: 'include archived repos'},
    {flags: '--forks', description: 'include forks'},
    {flags: '-a, --all', description: 'include disabled groups'},
    {flags: '--limit <n>', description: 'maximum repos to list per owner',
      default: 1000, parser: value => {
        const n = Number(value);
        if(!Number.isInteger(n) || n < 1) {
          throw new UsageError('--limit must be a positive integer.');
        }
        return n;
      }}
  ],
  progress: true,

  async run(context) {
    const {workspace, args, options, dryRun, env, runRepos, notice, jobs} =
      context;
    const add = Boolean(options.add || options.clone);
    const targets = selectGroups({workspace, ids: args, all: options.all,
      notice});

    if(add) {
      const byOwner = new Map();
      for(const target of targets) {
        byOwner.set(target.owner, [...byOwner.get(target.owner) ?? [],
          target.group.id]);
      }
      for(const [owner, ids] of byOwner) {
        if(ids.length > 1) {
          throw new UsageError(`Groups ${ids.join(', ')} all use ` +
            `github:${owner}; name the one to add to, e.g. ` +
            `mpm discover ${ids[0]} --add`);
        }
      }
    }

    // one gh call per owner
    const owners = [...new Set(targets.map(t => t.owner))];
    const queue = new PQueue({concurrency: jobs});
    const listings = new Map(await Promise.all(owners.map(owner =>
      queue.add(async () => [owner, await listRepos({
        owner, limit: options.limit, env
      })]))));
    for(const [owner, listing] of listings) {
      if(listing.repos?.length >= options.limit) {
        notice(`github:${owner} has at least ${options.limit} repos; ` +
          'results may be incomplete (use --limit).');
      }
    }

    const groups = targets.map(target => compare({
      target, workspace, listing: listings.get(target.owner), options
    }));
    const failed = groups.some(g => g.error);
    const output = {
      data: {groups},
      context: {},
      exitCode: failed ? EXIT.FAILED : EXIT.OK
    };

    const toAdd = groups.filter(g => g.new.length > 0);
    if(add && toAdd.length > 0) {
      const edit = await applyEdit({
        workspace, dryRun, env,
        async edit(editor, messages) {
          for(const group of toAdd) {
            const file = workspace.groups.find(g => g.id === group.id).file;
            const document = await editor.document(file);
            for(const repo of group.new) {
              insertEntry(document, newEntry({
                ref: repo.name, enabled: !options.disabled, tags: options.tag
              }));
              messages.push(`${dryRun ? 'would add' : 'added'} ${repo.name} ` +
                `to ${group.id}`);
            }
          }
        }
      });
      output.data.edit = edit.data;
      if(options.clone && !options.disabled) {
        const names = new Set(toAdd.flatMap(g => g.new.map(r => r.name)));
        const updated = edit.context.workspace;
        output.results = await runRepos(cloneTask(updated), {
          repos: updated.repos.filter(r => names.has(r.name))
        });
        if(output.results.some(r => r.status === 'failed')) {
          output.exitCode = EXIT.FAILED;
        }
      }
    }
    return output;
  },

  text: {
    repo: clone.text.repo,

    end(report, context) {
      const {c, quiet} = context;
      const {groups, edit} = report.data;
      const lines = [];
      for(const group of groups) {
        const heading =
          `${c.bold(group.id)} ${c.dim(`(github:${group.owner})`)}`;
        if(group.error) {
          lines.push(`${heading}: ${c.red(group.error)}`);
          continue;
        }
        const problems = group.new.length + group.conflicts.length +
          group.gone.length + group.archivedUpstream.length;
        if(problems === 0) {
          if(!quiet) {
            lines.push(`${heading}: ${c.green('up to date')}` +
              hiddenNote(group, c));
          }
          continue;
        }
        lines.push(`${heading}: ${group.new.length} new` +
          hiddenNote(group, c));
        for(const repo of group.new) {
          const flags = [repo.archived && 'archived', repo.fork && 'fork']
            .filter(Boolean);
          lines.push(`  ${c.green('+')} ${repo.name}` +
            (flags.length ? c.yellow(` (${flags.join(', ')})`) : '') +
            (repo.description ? c.dim(`  ${repo.description}`) : ''));
        }
        for(const conflict of group.conflicts) {
          lines.push(`  ${c.red('!')} ${conflict.name}  ` +
            c.dim(`name already used by group ${conflict.group} ` +
              `(${conflict.url})`));
        }
        for(const name of group.gone) {
          lines.push(`  ${c.red('-')} ${name}  ` +
            c.dim('configured but not found upstream'));
        }
        for(const name of group.archivedUpstream) {
          lines.push(`  ${c.yellow('~')} ${name}  ` +
            c.dim(`archived upstream; disable with: mpm repo disable ${name}`));
        }
      }
      if(edit) {
        lines.push(editText(edit, context));
      }
      if(report.results) {
        lines.push(clone.text.end(report, context));
      } else if(!edit && !quiet) {
        const count = groups.reduce((sum, g) => sum + g.new.length, 0);
        if(count > 0) {
          lines.push(`${count} new repo${count === 1 ? '' : 's'}; add ` +
            'with: mpm discover --add (or --clone)');
        }
      }
      return lines.filter(Boolean).join('\n');
    }
  }
};

function selectGroups({workspace, ids, all, notice}) {
  let groups;
  if(ids.length > 0) {
    groups = ids.map(id => {
      const group = workspace.groups.find(g => g.id === id);
      if(!group) {
        throw new UsageError(`Unknown group "${id}".`);
      }
      return group;
    });
  } else {
    groups = workspace.groups.filter(g => all || g.enabled);
  }
  const targets = [];
  for(const group of groups) {
    const owner = githubOwner(group.source, {root: workspace.root});
    if(owner) {
      targets.push({group, owner});
    } else if(ids.length > 0) {
      notice(`Group "${group.id}" does not have a GitHub source ` +
        '(github:owner); skipped.');
    }
  }
  if(targets.length === 0) {
    throw new UsageError('No groups with a GitHub source (github:owner) to ' +
      'check.');
  }
  return targets;
}

/**
 * List an owner's repos with the GitHub CLI.
 *
 * @param {object} options - Options.
 * @param {string} options.owner - User or org.
 * @param {number} options.limit - Maximum repos.
 * @param {object} options.env - Environment.
 *
 * @returns {Promise<{repos?: object[], error?: string}>} Repos or error.
 */
async function listRepos({owner, limit, env}) {
  let result;
  try {
    result = await spawnProcess('gh', ['repo', 'list', owner, '--limit',
      String(limit), '--json', GH_FIELDS], {env});
  } catch(e) {
    if(e instanceof ExecError) {
      throw new UsageError('discover needs the GitHub CLI (gh); see ' +
        'https://cli.github.com', {cause: e});
    }
    throw e;
  }
  if(result.code !== 0) {
    return {error: `gh repo list failed: ${errorSummary(result.stderr) ||
      `exit code ${result.code}`}`};
  }
  try {
    return {repos: JSON.parse(result.stdout)};
  } catch {
    return {error: 'gh repo list returned invalid JSON'};
  }
}

function compare({target, workspace, listing, options}) {
  const {group, owner} = target;
  const entry = {
    id: group.id,
    owner,
    new: [],
    conflicts: [],
    gone: [],
    archivedUpstream: [],
    hidden: {archived: 0, forks: 0}
  };
  if(listing.error) {
    entry.error = listing.error;
    return entry;
  }
  const byKey = new Map(workspace.repos.map(r => [urlKey(r.url), r]));
  const byName = new Map(workspace.repos.map(r => [r.name, r]));
  const upstreamKeys = new Set();
  for(const repo of listing.repos) {
    const key = urlKey(repo.url);
    upstreamKeys.add(key);
    const existing = byKey.get(key);
    if(existing) {
      if(repo.isArchived && existing.repoEnabled &&
        existing.group === group.id) {
        entry.archivedUpstream.push(existing.name);
      }
      continue;
    }
    if(repo.isArchived && !options.archived) {
      entry.hidden.archived++;
      continue;
    }
    if(repo.isFork && !options.forks) {
      entry.hidden.forks++;
      continue;
    }
    const taken = byName.get(repo.name);
    if(taken) {
      entry.conflicts.push({name: repo.name, group: taken.group,
        url: taken.url});
      continue;
    }
    entry.new.push({
      name: repo.name,
      description: repo.description || undefined,
      archived: repo.isArchived,
      fork: repo.isFork,
      url: repo.url
    });
  }
  // a truncated listing can not tell what is gone
  if(listing.repos.length < options.limit) {
    const prefix = `github.com/${owner.toLowerCase()}/`;
    for(const repo of workspace.repos) {
      const key = urlKey(repo.url);
      if(repo.group === group.id && key.startsWith(prefix) &&
        !upstreamKeys.has(key)) {
        entry.gone.push(repo.name);
      }
    }
  }
  entry.new.sort((a, b) => a.name.localeCompare(b.name));
  return entry;
}

function hiddenNote(group, c) {
  const parts = [];
  if(group.hidden.archived > 0) {
    parts.push(`${group.hidden.archived} archived`);
  }
  if(group.hidden.forks > 0) {
    parts.push(`${group.hidden.forks} fork${group.hidden.forks === 1 ?
      '' : 's'}`);
  }
  return parts.length > 0 ?
    c.dim(` (${parts.join(' and ')} not shown; --archived, --forks)`) : '';
}
