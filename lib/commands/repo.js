/**
 * `mpm repo <subcommand>`: manage repo entries in group configs.
 */
import {applyEdit, editCommandText, editText} from './edit-output.js';
import {cloneTask, default as clone} from './clone.js';
import {findEntry, insertEntry, newEntry, removeEntry, updateEntry}
  from '../config/repos.js';
import {isCloned, selectRepos} from '../repos/select.js';
import {isFullRef, refToName, resolveRepoUrl} from '../repos/source.js';
import fs from 'node:fs/promises';
import {createRepoContext} from '../run/runner.js';
import {getStatus} from '../git/status.js';
import {repoLine} from '../output/format.js';
import {UsageError} from '../errors.js';

const collect = (value, previous = []) => [...previous, value];

const add = {
  name: 'add',
  summary: 'Add repos to a group',
  description: 'Add repos to a group config, keeping the list sorted and ' +
    'comments intact. A reference can be a name (resolved against the ' +
    'group source), owner/name, or a full URL; URLs that match the group ' +
    'source are stored as short names.\n\n' +
    'Examples:\n' +
    '  mpm repo add core widget-new\n' +
    '  mpm repo add core --clone -t web widget-web-foo widget-web-bar\n' +
    '  mpm repo add misc https://gitlab.com/x/y.git',
  arguments: [
    {name: '<group>', description: 'group id'},
    {name: '<refs...>', description: 'repo names, owner/name, or URLs'}
  ],
  options: [
    {flags: '--name <name>', description: 'repo name (checkout directory); ' +
      'only with a single ref'},
    {flags: '-t, --tag <tag>', description: 'tag (repeatable)',
      parser: collect},
    {flags: '--description <text>', description: 'description'},
    {flags: '--disabled', description: 'add as disabled'},
    {flags: '--clone', description: 'clone the new repos'}
  ],

  async run({workspace, args, options, dryRun, runRepos}) {
    const [groupId, ...refs] = args.flat();
    const group = workspace.groups.find(g => g.id === groupId);
    if(!group) {
      throw new UsageError(`Unknown group "${groupId}".`, {
        details: ['Create it with: mpm group add ' + groupId]
      });
    }
    if(options.name && refs.length > 1) {
      throw new UsageError('--name can only be used with a single ref.');
    }
    const names = new Map(workspace.repos.map(r => [r.name, r.group]));
    const added = [];
    const output = await applyEdit({
      workspace, dryRun,
      async edit(editor, messages) {
        const document = await editor.document(group.file);
        for(const rawRef of refs) {
          const ref = shortenRef({ref: rawRef, group, workspace});
          const name = options.name ?? refToName(ref);
          if(names.has(name)) {
            throw new UsageError(`Repo "${name}" already exists in group ` +
              `"${names.get(name)}".`);
          }
          names.set(name, group.id);
          insertEntry(document, newEntry({
            ref, name, enabled: !options.disabled, tags: options.tag,
            description: options.description
          }));
          added.push(name);
          messages.push(`${dryRun ? 'would add' : 'added'} ${name} to ` +
            `${group.id}` + (ref === name ? '' : ` (${ref})`));
        }
      }
    });
    if(options.clone) {
      const repos = output.context.workspace.repos
        .filter(r => added.includes(r.name));
      output.results = await runRepos(
        cloneTask(output.context.workspace), {repos});
    }
    return output;
  },

  text: {
    repo: clone.text.repo,
    end(report, context) {
      const text = editText(report.data, context);
      if(!report.results) {
        return text;
      }
      return [text, clone.text.end(report, context)].filter(Boolean)
        .join('\n');
    }
  }
};

const remove = {
  name: 'rm',
  aliases: ['remove'],
  summary: 'Remove repos from their groups',
  description: 'Remove repos from their group configs. The checkout is ' +
    'kept unless --delete is given. --delete refuses to remove checkouts ' +
    'with uncommitted, untracked, stashed, or unpushed work unless --force ' +
    'is also given.',
  arguments: [{name: '<repos...>', description: 'repo names or globs'}],
  options: [
    {flags: '--delete', description: 'also delete the checkout directory'},
    {flags: '--force', description: 'delete checkouts even with local work'}
  ],

  async run({workspace, args, options, dryRun, runRepos, cwd}) {
    const repos = await resolveRepos(workspace, args.flat(), cwd);
    if(options.delete && !options.force) {
      const problems = [];
      for(const repo of repos) {
        const problem = await localWork(repo);
        if(problem) {
          problems.push(`${repo.name}: ${problem}`);
        }
      }
      if(problems.length > 0) {
        throw new UsageError('Refusing to delete checkouts with local work ' +
          '(use --force):', {details: problems});
      }
    }
    const output = await applyEdit({
      workspace, dryRun,
      async edit(editor, messages) {
        for(const repo of repos) {
          const group = workspace.groups.find(g => g.id === repo.group);
          removeEntry(await editor.document(group.file), repo.name);
          messages.push(`${dryRun ? 'would remove' : 'removed'} ` +
            `${repo.name} from ${repo.group}`);
        }
      }
    });
    if(options.delete) {
      output.results = await runRepos(async (repo, context) => {
        if(!await isCloned(repo)) {
          return {deleted: false};
        }
        await context.action(`delete ${repo.relPath}/`,
          () => fs.rm(repo.path, {recursive: true, force: true}));
        return {deleted: true};
      }, {repos});
    }
    return output;
  },

  text: {
    repo(result, context) {
      if(result.status === 'ok' && !result.data.deleted) {
        return;
      }
      return repoLine(result, context, result.status === 'ok' ?
        (context.dryRun ? context.c.cyan('would delete checkout') :
          'deleted checkout') : undefined);
    },
    end({data}, context) {
      return editText(data, context);
    }
  }
};

function enableCommand(enabled) {
  const verb = enabled ? 'enable' : 'disable';
  return {
    name: verb,
    summary: `${enabled ? 'Enable' : 'Disable'} repos`,
    description: `${enabled ? 'Enable' : 'Disable'} repos in their group ` +
      'configs. Disabled repos are skipped by all commands unless named ' +
      'explicitly or --all is given.',
    arguments: [{name: '<repos...>', description: 'repo names or globs'}],

    async run({workspace, args, dryRun, cwd, notice}) {
      const repos = await resolveRepos(workspace, args.flat(), cwd);
      return applyEdit({
        workspace, dryRun,
        async edit(editor, messages) {
          for(const repo of repos) {
            if(repo.repoEnabled === enabled) {
              messages.push(`${repo.name} is already ${verb}d`);
              continue;
            }
            const group = workspace.groups.find(g => g.id === repo.group);
            updateEntry(await editor.document(group.file), repo.name,
              data => ({...data, enabled}));
            messages.push(`${dryRun ? `would ${verb}` : `${verb}d`} ` +
              repo.name);
            if(enabled && !repo.groupEnabled) {
              notice(`Group "${repo.group}" of "${repo.name}" is disabled.`);
            }
          }
        }
      });
    },

    text: editCommandText
  };
}

const tag = {
  name: 'tag',
  summary: 'Add or remove repo tags',
  description: 'Add or remove tags on repos. Tags inherited from the group ' +
    'can only be changed on the group (mpm group tag).\n\n' +
    'Example:\n' +
    '  mpm repo tag \'widget-web-*\' --add web --remove archived',
  arguments: [{name: '<repos...>', description: 'repo names or globs'}],
  options: [
    {flags: '-a, --add <tag>', description: 'tag to add (repeatable)',
      parser: collect},
    {flags: '-r, --remove <tag>', description: 'tag to remove (repeatable)',
      parser: collect}
  ],

  async run({workspace, args, options, dryRun, cwd, notice}) {
    const addTags = options.add ?? [];
    const removeTags = options.remove ?? [];
    if(addTags.length === 0 && removeTags.length === 0) {
      throw new UsageError('Give --add and/or --remove tags.');
    }
    const repos = await resolveRepos(workspace, args.flat(), cwd);
    return applyEdit({
      workspace, dryRun,
      async edit(editor, messages) {
        for(const repo of repos) {
          const group = workspace.groups.find(g => g.id === repo.group);
          const document = await editor.document(group.file);
          updateEntry(document, repo.name, data => {
            const tags = new Set(data.tags ?? []);
            for(const t of addTags) {
              if(group.tags.includes(t)) {
                notice(`"${repo.name}" already has tag "${t}" from group ` +
                  `"${group.id}".`);
              } else {
                tags.add(t);
              }
            }
            for(const t of removeTags) {
              if(!tags.delete(t) && group.tags.includes(t)) {
                notice(`Tag "${t}" of "${repo.name}" comes from group ` +
                  `"${group.id}"; change it with: mpm group tag`);
              }
            }
            return {...data, tags: [...tags]};
          });
          const entry = findEntry(document, repo.name);
          const own = entry.node.toJSON?.()?.tags ?? [];
          messages.push(`${repo.name}: ${own.join(', ') || '(no own tags)'}`);
        }
      }
    });
  },

  text: editCommandText
};

const show = {
  name: 'show',
  summary: 'Show details of repos',
  arguments: [{name: '<repos...>', description: 'repo names or globs'}],

  async run({workspace, args, cwd}) {
    const repos = await resolveRepos(workspace, args.flat(), cwd);
    const data = [];
    for(const repo of repos) {
      const group = workspace.groups.find(g => g.id === repo.group);
      data.push({
        name: repo.name,
        group: repo.group,
        url: repo.url,
        path: repo.relPath,
        cloned: await isCloned(repo),
        enabled: repo.enabled,
        repoEnabled: repo.repoEnabled,
        groupEnabled: repo.groupEnabled,
        tags: repo.tags,
        groupTags: group.tags,
        ...(repo.description ? {description: repo.description} : {}),
        file: group.file
      });
    }
    return {data};
  },

  text: {
    end({data}, {c}) {
      return data.map(repo => {
        let enabled = repo.enabled ? c.green('yes') : c.yellow('no');
        if(!repo.repoEnabled) {
          enabled += c.dim(' (repo disabled)');
        } else if(!repo.groupEnabled) {
          enabled += c.dim(' (group disabled)');
        }
        const tags = repo.tags.map(t => repo.groupTags.includes(t) ?
          c.dim(t) : t).join(', ');
        return [
          c.bold(repo.name),
          `  group:    ${repo.group}`,
          `  url:      ${repo.url}`,
          `  path:     ${repo.path} ` +
            (repo.cloned ? c.green('(cloned)') : c.yellow('(missing)')),
          `  enabled:  ${enabled}`,
          `  tags:     ${tags || c.dim('none')}`,
          ...(repo.description ? [`  about:    ${repo.description}`] : []),
          `  config:   ${repo.file}`
        ].join('\n');
      }).join('\n\n');
    }
  }
};

/**
 * Store a full URL as a short name when it matches the group source.
 *
 * @param {object} options - Options.
 * @param {string} options.ref - Reference as given.
 * @param {object} options.group - Group.
 * @param {object} options.workspace - Workspace.
 *
 * @returns {string} Reference to store.
 */
export function shortenRef({ref, group, workspace}) {
  if(!isFullRef(ref) || !group.source) {
    return ref;
  }
  const name = refToName(ref);
  const normalize = url => url.replace(/\.git$/, '').replace(/\/+$/, '');
  for(const protocol of ['ssh', 'https']) {
    const fromName = resolveRepoUrl({
      ref: name, source: group.source, protocol, root: workspace.root
    });
    const given = resolveRepoUrl({ref, protocol, root: workspace.root});
    if(normalize(fromName) === normalize(given)) {
      return name;
    }
  }
  return ref;
}

async function resolveRepos(workspace, patterns, cwd) {
  const {repos} = await selectRepos(workspace, {repos: patterns, all: true},
    {cwd});
  return repos;
}

async function localWork(repo) {
  if(!await isCloned(repo)) {
    return null;
  }
  const context = createRepoContext({
    repo, dryRun: false, interactive: false, env: process.env
  });
  const status = await getStatus(context);
  const problems = [];
  if(status.dirty) {
    problems.push('uncommitted changes');
  }
  if(status.untracked > 0) {
    problems.push('untracked files');
  }
  if(status.stash > 0) {
    problems.push('stashes');
  }
  if(status.ahead > 0) {
    problems.push('unpushed commits');
  }
  if(!status.detached && !status.upstream) {
    problems.push('branch without upstream');
  }
  return problems.length > 0 ? problems.join(', ') : null;
}

export default {
  name: 'repo',
  helpGroup: 'Workspace and config commands:',
  summary: 'Manage repo entries in the config',
  description: 'Add, remove, enable, disable, tag, and show repos. Config ' +
    'files are edited in place, keeping comments; use --dry-run to see the ' +
    'diff first.',
  subcommands: [
    add,
    remove,
    enableCommand(true),
    enableCommand(false),
    tag,
    show
  ]
};
