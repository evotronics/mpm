/**
 * `mpm config <subcommand>`: workspace settings and config files.
 */
import {applyEdit, editCommandText} from './edit-output.js';
import {DEFAULT_SETTINGS, loadWorkspace} from '../workspace/load.js';
import {ConfigError, UsageError} from '../errors.js';
import {CONFIG_FILE} from '../config/files.js';
import path from 'node:path';
import {spawnProcess} from '../run/exec.js';
import YAML from 'yaml';

const SETTINGS = Object.keys(DEFAULT_SETTINGS);

/**
 * Convert a user key to a path in mpm.yaml. Bare setting names are
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
  description: 'Show a value from mpm.yaml with defaults applied, e.g. ' +
    '`mpm config get jobs` or `mpm config get settings.protocol`. With no ' +
    'key, show all settings and aliases.',
  arguments: [{name: '[key]', description: 'dotted key'}],

  async run({workspace, args}) {
    const effective = {
      version: 1,
      settings: workspace.settings,
      aliases: workspace.aliases
    };
    if(!args[0]) {
      return {data: effective};
    }
    let value = effective;
    for(const part of keyPath(args[0])) {
      value = value?.[part];
    }
    if(value === undefined) {
      throw new UsageError(`"${args[0]}" is not set.`);
    }
    return {data: value};
  },

  text: {
    end({data}) {
      return typeof data === 'object' ? YAML.stringify(data).trimEnd() :
        String(data);
    }
  }
};

const set = {
  name: 'set',
  summary: 'Set a value in mpm.yaml',
  description: 'Set a value in mpm.yaml, e.g. `mpm config set jobs 16` or ' +
    '`mpm config set aliases.up "pull --rebase"`. The result is validated ' +
    'before it is written.',
  arguments: [
    {name: '<key>', description: 'dotted key'},
    {name: '<value>', description: 'value (numbers and true/false are ' +
      'converted)'}
  ],

  async run({workspace, args, dryRun}) {
    const [key, raw] = args;
    const pathParts = keyPath(key);
    const value = parseValue(raw);
    return applyEdit({
      workspace, dryRun,
      async edit(editor, messages) {
        const document = await editor.document(editor.configFile);
        document.setIn(pathParts, value);
        messages.push(`${pathParts.join('.')} = ${JSON.stringify(value)}`);
      }
    });
  },

  text: editCommandText
};

const unset = {
  name: 'unset',
  summary: 'Remove a value from mpm.yaml (reverting to the default)',
  arguments: [{name: '<key>', description: 'dotted key'}],

  async run({workspace, args, dryRun}) {
    const pathParts = keyPath(args[0]);
    return applyEdit({
      workspace, dryRun,
      async edit(editor, messages) {
        const document = await editor.document(editor.configFile);
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

  async run({workspace}) {
    return {
      data: {
        root: workspace.root,
        config: workspace.configFile,
        groupsDir: workspace.groupsDir,
        groups: Object.fromEntries(workspace.groups.map(g => [g.id, g.file]))
      }
    };
  },

  text: {
    end({data}, {c}) {
      return [
        `${c.dim('workspace:')} ${data.root}`,
        `${c.dim('config:')}    ${data.config}`,
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
  summary: 'Open mpm.yaml or a group file in an editor',
  description: 'Open mpm.yaml (or mpm.d/<group>.yaml) in $VISUAL or ' +
    '$EDITOR, then validate the workspace.',
  arguments: [{name: '[group]', description: 'group id'}],

  async run({workspace, args, dryRun, env, cwd}) {
    let file = workspace.configFile;
    if(args[0]) {
      const group = workspace.groups.find(g => g.id === args[0]);
      if(!group) {
        throw new UsageError(`Unknown group "${args[0]}".`);
      }
      file = group.file;
    }
    const editor = env.VISUAL || env.EDITOR || 'vi';
    const display = path.relative(cwd, file) || file;
    if(dryRun) {
      return {data: {file, editor, messages: [`would run: ${editor} ` +
        display]}};
    }
    // the editor command may include arguments, e.g. "code --wait"
    const result = await spawnProcess('sh', ['-c', `${editor} "$1"`,
      'mpm-edit', file], {interactive: true, env});
    if(result.code !== 0) {
      throw new UsageError(`Editor exited with code ${result.code}.`);
    }
    try {
      await loadWorkspace({root: workspace.root});
    } catch(e) {
      if(e instanceof ConfigError) {
        e.message = `${e.message} Fix it with: mpm config edit ` +
          (args[0] ?? '');
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
  summary: `Show and change settings in ${CONFIG_FILE}`,
  subcommands: [get, set, unset, paths, validate, edit]
};
