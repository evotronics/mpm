/**
 * `mpm init`: create a workspace.
 */
import {CONFIG_FILE, GROUPS_DIR} from '../config/files.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathExists} from '../util/fs.js';
import {trustWorkspace} from './trust.js';
import {UsageError} from '../errors.js';

const WORKSPACE_TEMPLATE = `\
# mpm workspace config.
#
# Repo groups are defined in ${GROUPS_DIR}/<group>.yaml files, for example:
#
#   # ${GROUPS_DIR}/example.yaml
#   title: Example Org
#   source: github:example-org
#   tags: [example]
#   repos:
#     - some-repo
#     - other-owner/other-repo
#     - name: old-repo
#       enabled: false
#
# Settings not given here come from the user config
# (~/.config/mpm/config.yaml), then defaults. MPM_PROTOCOL overrides the
# protocol.
version: 1
{{settings}}
`;

const SETTINGS_COMMENT = `\
# settings:
#   # Number of repos to process in parallel (default 8).
#   jobs: 8
#   # How host shorthand sources like "github:owner" expand: ssh or https
#   # (default ssh).
#   protocol: ssh`;

export default {
  name: 'init',
  helpGroup: 'Workspace and config commands:',
  summary: 'Create a workspace config',
  description: `Create "${CONFIG_FILE}" and "${GROUPS_DIR}/" in a directory ` +
    '(default: the current directory), and add it to the trusted ' +
    'workspaces in the user config (see `mpm trust`).',
  workspace: false,
  arguments: [{name: '[dir]', description: 'workspace directory',
    complete: 'dirs'}],
  options: [
    {
      flags: '--protocol <protocol>',
      description: 'clone protocol for host shorthand sources (default: ' +
        'from the user config, else ssh)',
      choices: ['ssh', 'https']
    },
    {flags: '--force', description: 'overwrite existing files'}
  ],

  async run({args, options, cwd, dryRun, env}) {
    const root = path.resolve(cwd, args[0] ?? '.');
    const file = path.join(root, CONFIG_FILE);
    const content = WORKSPACE_TEMPLATE.replace('{{settings}}',
      options.protocol ? `settings:\n  protocol: ${options.protocol}` :
        SETTINGS_COMMENT);

    if(!options.force && await pathExists(file)) {
      throw new UsageError('Refusing to overwrite existing files ' +
        '(use --force):', {details: [displayPath(file, cwd)]});
    }

    if(!dryRun) {
      await fs.mkdir(path.join(root, GROUPS_DIR), {recursive: true});
      await fs.writeFile(file, content);
    }

    const trusted = await trustWorkspace({root, dryRun, env, cwd});
    return {
      data: {root, files: [CONFIG_FILE], trust: trusted.data.messages},
      context: {file, content}
    };
  },

  text: {
    end({data, context, dryRun}, {c, verbose}) {
      const lines = [];
      const verb = dryRun ? c.cyan('would write') : 'wrote';
      lines.push(`${verb} ${context.file}`);
      if(dryRun && verbose) {
        lines.push(c.dim(context.content.replace(/^/gm, '  ')));
      }
      lines.push(...data.trust);
      if(!dryRun) {
        lines.push(`Add repo groups as ${GROUPS_DIR}/<group>.yaml files; see ` +
          `the comments in ${CONFIG_FILE}.`);
      }
      return lines.join('\n');
    }
  }
};

function displayPath(file, cwd) {
  const relative = path.relative(cwd, file);
  return relative && !relative.startsWith('..') ? relative : file;
}
