/**
 * `mpm config <subcommand>`: workspace settings and config files.
 */
import {applyEdit, editCommandText} from './edit-output.js';
import {ConfigError, UsageError} from '../errors.js';
import {DEFAULT_SETTINGS, loadWorkspace} from '../workspace/load.js';
import {displayUserPath, loadUserConfig, userConfigFile}
  from '../config/user.js';
import {CONFIG_FILE} from '../config/files.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathExists} from '../util/fs.js';
import {spawnProcess} from '../run/exec.js';
import YAML from 'yaml';

const USER_OPTION = {
  flags: '--user',
  description: 'use the user config (~/.config/mpm/config.yaml) instead of ' +
    'mpm.yaml; works outside a workspace'
};
const USER_TEMPLATE = `\
# mpm user config: defaults for all workspaces. A workspace's mpm.yaml
# overrides these, and MPM_PROTOCOL overrides the protocol everywhere.
version: 1
settings:
  # protocol: https
  # jobs: 8
`;

const SETTINGS = Object.keys(DEFAULT_SETTINGS);

/**
 * Convert a key to a path in a config file. Bare setting names are
 * shorthand for `settings.<name>`.
 *
 * @param {string} key - Dotted key.
 *
 * @returns {string[]} Path.
 */
function keyPath(key) {
  const parts = key.split('.').filter(Boolean);
  if(parts.length === 0) {
    throw new UsageError(`Invalid key "${key}".`);
  }
  if(parts.length === 1 && SETTINGS.includes(parts[0])) {
    return ['settings', parts[0]];
  }
  return parts;
}

function parseValue(value) {
  if(/^-?\d+$/.test(value)) {
    return Number(value);
  }
  if(value === 'true' || value === 'false') {
    return value === 'true';
  }
  return value;
}

const get = {
  name: 'get',
  summary: 'Show effective settings, or one value',
  description: 'Show a setting with defaults, the user config, mpm.yaml, ' +
    'and MPM_PROTOCOL applied, e.g. `mpm config get jobs` or ' +
    '`mpm config get settings.protocol`. With no key, show all settings and ' +
    'aliases. --show-origin tells where each setting came from; --user ' +
    'shows only the user config.',
  workspace: options => !options.user,
  arguments: [{name: '[key]', description: 'dotted key'}],
  options: [
    USER_OPTION,
    {flags: '--show-origin', description: 'show where settings come from'}
  ],

  async run({workspace, args, options, env}) {
    let effective;
    let origins;
    if(options.user) {
      const user = await loadUserConfig({env});
      effective = {version: 1, settings: user.settings, aliases: user.aliases};
      const origin = displayUserPath(user.file, env);
      origins = Object.fromEntries(
        Object.keys(user.settings).map(key => [key, origin]));
    } else {
      effective = {
        version: 1,
        settings: workspace.settings,
        aliases: workspace.aliases
      };
      origins = workspace.settingOrigins;
    }
    if(!args[0]) {
      return {
        data: options.showOrigin ? {...effective, origins} : effective,
        context: {origins}
      };
    }
    const pathParts = keyPath(args[0]);
    let value = effective;
    for(const part of pathParts) {
      value = value?.[part];
    }
    if(value === undefined) {
      throw new UsageError(`"${args[0]}" is not set.`);
    }
    const origin = pathParts[0] === 'settings' && pathParts.length === 2 ?
      origins[pathParts[1]] : undefined;
    return {
      data: options.showOrigin ? {value, origin: origin ?? null} : value,
      context: {origin}
    };
  },

  text: {
    end({data, context}, {c, options}) {
      if(options.showOrigin && context.origins) {
        const lines = Object.entries(data.settings).map(([key, value]) =>
          `${key}: ${value}  ${c.dim(`(${data.origins[key]})`)}`);
        const aliases = Object.entries(data.aliases);
        if(aliases.length > 0) {
          lines.push('aliases:', YAML.stringify(Object.fromEntries(aliases))
            .trimEnd().replace(/^/gm, '  '));
        }
        return lines.join('\n');
      }
      if(options.showOrigin) {
        return `${formatValue(data.value)}` +
          (data.origin ? `  ${c.dim(`(${data.origin})`)}` : '');
      }
      return formatValue(data);
    }
  }
};

function formatValue(value) {
  return typeof value === 'object' ? YAML.stringify(value).trimEnd() :
    String(value);
}

const set = {
  name: 'set',
  summary: 'Set a value in mpm.yaml (or the user config)',
  description: 'Set a value in mpm.yaml, e.g. `mpm config set jobs 16` or ' +
    '`mpm config set aliases.up "pull --rebase"`. With --user, set it in ' +
    'the user config, e.g. `mpm config set --user protocol https`. The ' +
    'result is validated before it is written.',
  workspace: options => !options.user,
  options: [USER_OPTION],
  arguments: [
    {name: '<key>', description: 'dotted key'},
    {name: '<value>', description: 'value (numbers and true/false are ' +
      'converted)'}
  ],

  async run({workspace, args, options, dryRun, env}) {
    const [key, raw] = args;
    const pathParts = keyPath(key);
    const value = parseValue(raw);
    return applyEdit({
      workspace, dryRun, env,
      async edit(editor, messages) {
        const document = options.user ? await editor.userDocument() :
          await editor.document(editor.configFile);
        document.setIn(pathParts, value);
        messages.push(`${pathParts.join('.')} = ${JSON.stringify(value)}`);
      }
    });
  },

  text: editCommandText
};

const unset = {
  name: 'unset',
  summary: 'Remove a value from mpm.yaml or the user config',
  workspace: options => !options.user,
  options: [USER_OPTION],
  arguments: [{name: '<key>', description: 'dotted key'}],

  async run({workspace, args, options, dryRun, env}) {
    const pathParts = keyPath(args[0]);
    return applyEdit({
      workspace, dryRun, env,
      async edit(editor, messages) {
        if(options.user && !await pathExists(editor.userConfigFile)) {
          messages.push(`${pathParts.join('.')} is not set`);
          return;
        }
        const document = options.user ? await editor.userDocument() :
          await editor.document(editor.configFile);
        if(!document.hasIn(pathParts)) {
          messages.push(`${pathParts.join('.')} is not set`);
          return;
        }
        document.deleteIn(pathParts);
        // drop an emptied parent map
        const parent = pathParts.slice(0, -1);
        const node = parent.length > 0 && document.getIn(parent, true);
        if(YAML.isMap(node) && node.items.length === 0) {
          document.deleteIn(parent);
        }
        messages.push(`unset ${pathParts.join('.')}`);
      }
    });
  },

  text: editCommandText
};

const paths = {
  name: 'path',
  aliases: ['paths'],
  summary: 'Show config file locations',

  async run({workspace, env}) {
    const user = userConfigFile(env);
    return {
      data: {
        root: workspace.root,
        config: workspace.configFile,
        groupsDir: workspace.groupsDir,
        groups: Object.fromEntries(workspace.groups.map(g => [g.id, g.file])),
        user,
        userExists: await pathExists(user)
      }
    };
  },

  text: {
    end({data}, {c}) {
      return [
        `${c.dim('workspace:')} ${data.root}`,
        `${c.dim('config:')}    ${data.config}`,
        `${c.dim('user:')}      ${data.user}` +
          (data.userExists ? '' : c.dim(' (not created)')),
        `${c.dim('groups:')}    ${data.groupsDir}`,
        ...Object.entries(data.groups).map(([id, file]) =>
          `  ${c.dim(id + ':')} ${file}`)
      ].join('\n');
    }
  }
};

const validate = {
  name: 'validate',
  summary: 'Check the config for errors',
  description: 'Load and validate mpm.yaml and all group files. Errors are ' +
    'reported with file and location, and the exit status is 2.',

  async run({workspace}) {
    return {
      data: {
        valid: true,
        groups: workspace.groups.length,
        repos: workspace.repos.length
      }
    };
  },

  text: {
    end({data}, {c}) {
      return `${c.green('✓')} config is valid: ${data.groups} groups, ` +
        `${data.repos} repos`;
    }
  }
};

const edit = {
  name: 'edit',
  summary: 'Open mpm.yaml, a group file, or the user config in an editor',
  description: 'Open mpm.yaml (or mpm.d/<group>.yaml, or with --user the ' +
    'user config) in $VISUAL or $EDITOR, then validate it.',
  workspace: options => !options.user,
  options: [USER_OPTION],
  arguments: [{name: '[group]', description: 'group id'}],

  async run({workspace, args, options, dryRun, env, cwd}) {
    if(options.user && args[0]) {
      throw new UsageError('Give a group or --user, not both.');
    }
    let file = options.user ? userConfigFile(env) : workspace.configFile;
    if(args[0]) {
      const group = workspace.groups.find(g => g.id === args[0]);
      if(!group) {
        throw new UsageError(`Unknown group "${args[0]}".`);
      }
      file = group.file;
    }
    const editor = env.VISUAL || env.EDITOR || 'vi';
    const display = options.user ? displayUserPath(file, env) :
      path.relative(cwd, file) || file;
    if(dryRun) {
      return {data: {file, editor, messages: [`would run: ${editor} ` +
        display]}};
    }
    if(options.user && !await pathExists(file)) {
      await fs.mkdir(path.dirname(file), {recursive: true});
      await fs.writeFile(file, USER_TEMPLATE);
    }
    // the editor command may include arguments, e.g. "code --wait"
    const result = await spawnProcess('sh', ['-c', `${editor} "$1"`,
      'mpm-edit', file], {interactive: true, env});
    if(result.code !== 0) {
      throw new UsageError(`Editor exited with code ${result.code}.`);
    }
    try {
      if(workspace) {
        await loadWorkspace({root: workspace.root, env});
      } else {
        await loadUserConfig({env});
      }
    } catch(e) {
      if(e instanceof ConfigError) {
        e.message = `${e.message} Fix it with: mpm config edit ` +
          (options.user ? '--user' : args[0] ?? '');
      }
      throw e;
    }
    return {data: {file, editor, messages: [`${display} is valid`]}};
  },

  text: {
    end({data}) {
      return data.messages.join('\n');
    }
  }
};

export default {
  name: 'config',
  helpGroup: 'Workspace and config commands:',
  summary: `Show and change settings in ${CONFIG_FILE} and the user config`,
  subcommands: [get, set, unset, paths, validate, edit]
};
