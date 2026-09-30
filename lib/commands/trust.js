/**
 * `mpm trust` / `mpm untrust`: manage the user config's list of workspace
 * directories whose `mpm.yaml` may be loaded automatically.
 */
import {applyEdit, editText} from './edit-output.js';
import {CONFIG_FILE, readYamlFile} from '../config/files.js';
import {displayUserPath, loadUserConfig} from '../config/user.js';
import path from 'node:path';
import {pathExists} from '../util/fs.js';
import {trustPath} from '../workspace/find.js';
import {UsageError} from '../errors.js';
import YAML from 'yaml';

/**
 * Add a workspace directory to the trusted list.
 *
 * @param {object} options - Options.
 * @param {string} options.root - Workspace directory.
 * @param {boolean} options.dryRun - Dry run.
 * @param {object} options.env - Environment.
 * @param {string} [options.cwd] - Current directory.
 *
 * @returns {Promise<object>} `applyEdit()` output.
 */
export async function trustWorkspace({root, dryRun, env, cwd}) {
  const dir = await trustPath(root, {cwd, env});
  return applyEdit({
    dryRun, env,
    async edit(editor, messages) {
      const document = await editor.userDocument();
      const {trusted} = await loadUserConfig({env});
      for(const entry of trusted) {
        if(await trustPath(entry, {cwd, env}) === dir) {
          messages.push(`${dir} is already trusted`);
          return;
        }
      }
      trustedSeq(document, {create: true}).items.push(
        document.createNode(dir));
      messages.push(`${dryRun ? 'would trust' : 'trusted'} ${dir}`);
    }
  });
}

const trust = {
  name: 'trust',
  helpGroup: 'Workspace and config commands:',
  summary: 'Trust a workspace so its mpm.yaml is loaded automatically',
  description: 'Add a workspace directory (default: the current directory) ' +
    'to the trusted list in the user config. A workspace config can run ' +
    'commands through aliases, so an mpm.yaml found by walking up from the ' +
    'current directory is only used if its directory is trusted; others ' +
    'are ignored with a notice. Workspaces given with -C or MPM_WORKSPACE, ' +
    'and those created by `mpm init`, do not need this. Review the ' +
    'workspace\'s aliases (listed when trusting) before trusting a ' +
    'config you did not write.',
  workspace: false,
  arguments: [{name: '[dir]', description: 'workspace directory',
    complete: 'dirs'}],
  options: [{flags: '-l, --list', description: 'list trusted directories'}],

  async run({args, options, dryRun, env, cwd}) {
    if(options.list) {
      const {file, trusted} = await loadUserConfig({env});
      const entries = [];
      for(const entry of trusted) {
        const dir = await trustPath(entry, {cwd, env});
        entries.push({
          path: entry,
          exists: await pathExists(path.join(dir, CONFIG_FILE))
        });
      }
      return {data: {file, trusted: entries}, context: {list: true}};
    }
    const root = await trustPath(args[0] ?? '.', {cwd, env});
    const configFile = path.join(root, CONFIG_FILE);
    if(!await pathExists(configFile)) {
      throw new UsageError(`No "${CONFIG_FILE}" in "${root}".`);
    }
    // show what trusting enables
    let aliases = {};
    try {
      const {data} = await readYamlFile(configFile);
      aliases = data?.aliases && typeof data.aliases === 'object' ?
        data.aliases : {};
    } catch {
      // invalid config: trusting it is still allowed, loading will fail
    }
    const output = await trustWorkspace({root, dryRun, env, cwd});
    output.data.aliases = aliases;
    return output;
  },

  text: {
    end({data, context}, format) {
      const {c} = format;
      if(context?.list) {
        if(data.trusted.length === 0) {
          return c.dim(`No trusted workspaces in ` +
            `${displayUserPath(data.file)}.`);
        }
        return data.trusted.map(t => t.exists ? t.path :
          `${t.path} ${c.yellow(`(no ${CONFIG_FILE})`)}`).join('\n');
      }
      const lines = [];
      const aliases = Object.entries(data.aliases);
      if(aliases.length > 0) {
        lines.push(c.bold('This workspace defines aliases:'));
        for(const [name, value] of aliases) {
          lines.push(`  ${name}: ${Array.isArray(value) ?
            JSON.stringify(value) : value}`);
        }
      }
      lines.push(editText(data, format));
      return lines.join('\n');
    }
  }
};

const untrust = {
  name: 'untrust',
  helpGroup: 'Workspace and config commands:',
  summary: 'Remove a workspace from the trusted list',
  workspace: false,
  arguments: [{name: '[dir]', description: 'workspace directory',
    complete: 'dirs'}],

  async run({args, dryRun, env, cwd}) {
    const dir = args[0] ?? '.';
    const target = await trustPath(dir, {cwd, env});
    return applyEdit({
      dryRun, env,
      async edit(editor, messages) {
        const {trusted} = await loadUserConfig({env});
        const remove = [];
        for(const entry of trusted) {
          if(entry === dir || await trustPath(entry, {cwd, env}) === target) {
            remove.push(entry);
          }
        }
        if(remove.length === 0) {
          messages.push(`${target} is not trusted`);
          return;
        }
        const document = await editor.userDocument();
        removeTrusted(document, remove);
        messages.push(`${dryRun ? 'would untrust' : 'untrusted'} ${target}`);
      }
    });
  },

  text: {
    end({data}, format) {
      return editText(data, format);
    }
  }
};

function trustedSeq(document, {create = false} = {}) {
  let seq = document.get('trusted', true);
  if(!YAML.isSeq(seq) && create) {
    seq = document.createNode([]);
    document.set('trusted', seq);
  }
  if(seq) {
    seq.flow = false;
  }
  return seq;
}

function removeTrusted(document, entries) {
  const seq = trustedSeq(document);
  seq.items = seq.items.filter(item => !entries.includes(String(item.value)));
  if(seq.items.length === 0) {
    document.delete('trusted');
  }
}

export {trust, untrust};
