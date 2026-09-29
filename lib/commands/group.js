/**
 * `mpm group <subcommand>`: manage group configs.
 */
import {applyEdit, editCommandText} from './edit-output.js';
import {GROUP_ID_PATTERN, GROUPS_DIR} from '../config/files.js';
import {formatTable} from '../output/format.js';
import path from 'node:path';
import {UsageError} from '../errors.js';
import YAML from 'yaml';

const collect = (value, previous = []) => [...previous, value];

function findGroups(workspace, ids) {
  return ids.map(id => {
    const group = workspace.groups.find(g => g.id === id);
    if(!group) {
      throw new UsageError(`Unknown group "${id}".`, {
        details: [`Known groups: ${
          workspace.groups.map(g => g.id).join(', ') || '(none)'}`]
      });
    }
    return group;
  });
}

const list = {
  name: 'list',
  aliases: ['ls'],
  summary: 'List groups',

  async run({workspace}) {
    return {
      data: workspace.groups.map(group => {
        const repos = workspace.repos.filter(r => r.group === group.id);
        return {
          id: group.id,
          title: group.title ?? null,
          source: group.source ?? null,
          enabled: group.enabled,
          tags: group.tags,
          repos: repos.length,
          enabledRepos: repos.filter(r => r.repoEnabled).length,
          file: path.relative(workspace.root, group.file)
        };
      })
    };
  },

  text: {
    end({data}, {c}) {
      if(data.length === 0) {
        return c.dim(`No groups. Add one with: mpm group add <id>`);
      }
      const rows = [['GROUP', 'REPOS', 'SOURCE', 'TAGS', 'TITLE']
        .map(c.dim)];
      for(const group of data) {
        rows.push([
          group.enabled ? group.id : c.dim(`${group.id} (disabled)`),
          group.enabledRepos === group.repos ? String(group.repos) :
            `${group.enabledRepos}/${group.repos}`,
          group.source ?? c.dim('—'),
          group.tags.join(','),
          group.title ?? ''
        ]);
      }
      return formatTable(rows);
    }
  }
};

const add = {
  name: 'add',
  summary: 'Create a group',
  description: `Create ${GROUPS_DIR}/<id>.yaml.\n\n` +
    'Example:\n' +
    '  mpm group add core --source github:example-org --title ' +
    '"Example Org" -t core',
  arguments: [{name: '<id>', description: 'group id (file name)'}],
  options: [
    {flags: '--source <source>', description: 'base for short repo names, ' +
      'e.g. github:owner'},
    {flags: '--title <title>', description: 'display title'},
    {flags: '--description <text>', description: 'description'},
    {flags: '-t, --tag <tag>', description: 'tag for all repos in the group ' +
      '(repeatable)', parser: collect},
    {flags: '--disabled', description: 'create the group disabled'}
  ],

  async run({workspace, env, args, options, dryRun}) {
    const [id] = args;
    if(!GROUP_ID_PATTERN.test(id)) {
      throw new UsageError(`Invalid group id "${id}".`);
    }
    if(workspace.groups.some(g => g.id === id)) {
      throw new UsageError(`Group "${id}" already exists.`);
    }
    return applyEdit({
      workspace, dryRun, env,
      async edit(editor, messages) {
        const data = {};
        if(options.title) {
          data.title = options.title;
        }
        if(options.description) {
          data.description = options.description;
        }
        if(options.source) {
          data.source = options.source;
        }
        if(options.disabled) {
          data.enabled = false;
        }
        if(options.tag) {
          data.tags = options.tag;
        }
        data.repos = [];
        const document = editor.create(editor.groupFile(id), data);
        const tags = document.get('tags', true);
        if(tags) {
          tags.flow = true;
        }
        messages.push(`${dryRun ? 'would add' : 'added'} group ${id}`);
      }
    });
  },

  text: editCommandText
};

const remove = {
  name: 'rm',
  aliases: ['remove'],
  summary: 'Delete a group config',
  description: 'Delete a group config file. Refuses when the group still ' +
    'has repos unless --force is given. Checkouts are not touched.',
  arguments: [{name: '<ids...>', description: 'group ids'}],
  options: [{flags: '--force', description: 'delete even if it has repos'}],

  async run({workspace, env, args, options, dryRun}) {
    const groups = findGroups(workspace, args);
    if(!options.force) {
      const nonEmpty = groups.filter(g => g.repos.length > 0);
      if(nonEmpty.length > 0) {
        throw new UsageError('Refusing to delete groups with repos (use ' +
          '--force):', {
          details: nonEmpty.map(g => `${g.id}: ${g.repos.length} repos`)
        });
      }
    }
    return applyEdit({
      workspace, dryRun, env,
      async edit(editor, messages) {
        for(const group of groups) {
          await editor.remove(group.file);
          messages.push(`${dryRun ? 'would remove' : 'removed'} group ` +
            group.id);
        }
      }
    });
  },

  text: editCommandText
};

function enableCommand(enabled) {
  const verb = enabled ? 'enable' : 'disable';
  return {
    name: verb,
    summary: `${enabled ? 'Enable' : 'Disable'} groups`,
    arguments: [{name: '<ids...>', description: 'group ids'}],

    async run({workspace, env, args, dryRun}) {
      const groups = findGroups(workspace, args);
      return applyEdit({
        workspace, dryRun, env,
        async edit(editor, messages) {
          for(const group of groups) {
            if(group.enabled === enabled) {
              messages.push(`group ${group.id} is already ${verb}d`);
              continue;
            }
            const document = await editor.document(group.file);
            if(enabled) {
              document.delete('enabled');
            } else {
              setBeforeRepos(document, 'enabled', false);
            }
            messages.push(`${dryRun ? `would ${verb}` : `${verb}d`} group ` +
              group.id);
          }
        }
      });
    },

    text: editCommandText
  };
}

const set = {
  name: 'set',
  summary: 'Change group settings',
  arguments: [{name: '<id>', description: 'group id'}],
  options: [
    {flags: '--source <source>', description: 'base for short repo names'},
    {flags: '--title <title>', description: 'display title'},
    {flags: '--description <text>', description: 'description'}
  ],

  async run({workspace, env, args, options, dryRun}) {
    const [group] = findGroups(workspace, args);
    const fields = ['title', 'description', 'source']
      .filter(key => options[key] !== undefined);
    if(fields.length === 0) {
      throw new UsageError('Nothing to set; give --title, --description, ' +
        'or --source.');
    }
    return applyEdit({
      workspace, dryRun, env,
      async edit(editor, messages) {
        const document = await editor.document(group.file);
        for(const key of fields) {
          if(options[key] === '') {
            document.delete(key);
          } else {
            setBeforeRepos(document, key, options[key]);
          }
          messages.push(`${group.id}: ${key} = ${options[key] || '(unset)'}`);
        }
      }
    });
  },

  text: editCommandText
};

const tag = {
  name: 'tag',
  summary: 'Add or remove group tags (inherited by all its repos)',
  arguments: [{name: '<ids...>', description: 'group ids'}],
  options: [
    {flags: '-a, --add <tag>', description: 'tag to add (repeatable)',
      parser: collect},
    {flags: '-r, --remove <tag>', description: 'tag to remove (repeatable)',
      parser: collect}
  ],

  async run({workspace, env, args, options, dryRun}) {
    const groups = findGroups(workspace, args);
    if(!options.add && !options.remove) {
      throw new UsageError('Give --add and/or --remove tags.');
    }
    return applyEdit({
      workspace, dryRun, env,
      async edit(editor, messages) {
        for(const group of groups) {
          const document = await editor.document(group.file);
          const tags = new Set(group.tags);
          (options.add ?? []).forEach(t => tags.add(t));
          (options.remove ?? []).forEach(t => tags.delete(t));
          if(tags.size === 0) {
            document.delete('tags');
          } else {
            const node = document.createNode([...tags]);
            node.flow = true;
            setBeforeRepos(document, 'tags', node);
          }
          messages.push(`${group.id}: ${[...tags].join(', ') || '(no tags)'}`);
        }
      }
    });
  },

  text: editCommandText
};

/**
 * Set a top-level key, adding new keys before `repos` so the long repo list
 * stays at the end of the file.
 *
 * @param {YAML.Document} document - Group document.
 * @param {string} key - Key.
 * @param {*} value - Value or node.
 */
function setBeforeRepos(document, key, value) {
  const map = document.contents;
  if(map.has(key)) {
    map.set(key, value);
    return;
  }
  const pair = document.createPair(key, value);
  const index = map.items.findIndex(
    p => YAML.isScalar(p.key) && p.key.value === 'repos');
  if(index === -1) {
    map.items.push(pair);
  } else {
    map.items.splice(index, 0, pair);
  }
}

export default {
  name: 'group',
  helpGroup: 'Workspace and config commands:',
  summary: 'Manage groups',
  description: `Create, remove, enable, disable, and tag groups ` +
    `(${GROUPS_DIR}/<id>.yaml files). Use --dry-run to see the diff first.`,
  subcommands: [
    list,
    add,
    remove,
    enableCommand(true),
    enableCommand(false),
    set,
    tag
  ]
};
