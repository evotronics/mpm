/**
 * `mpm init`: create a workspace.
 */
import {CONFIG_FILE, GROUPS_DIR} from '../config/files.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathExists} from '../util/fs.js';
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
version: 1
settings:
  # Number of repos to process in parallel.
  jobs: 8
  # How host shorthand sources like "github:owner" expand: ssh or https.
  protocol: {{protocol}}
`;

export default {
  name: 'init',
  helpGroup: 'Workspace and config commands:',
  summary: 'Create a workspace config',
  description: `Create "${CONFIG_FILE}" and "${GROUPS_DIR}/" in a directory ` +
    '(default: the current directory).',
  workspace: false,
  arguments: [{name: '[dir]', description: 'workspace directory'}],
  options: [
    {
      flags: '--protocol <protocol>',
      description: 'clone protocol for host shorthand sources',
      choices: ['ssh', 'https'],
      default: 'ssh'
    },
    {flags: '--force', description: 'overwrite existing files'}
  ],

  async run({args, options, cwd, dryRun}) {
    const root = path.resolve(cwd, args[0] ?? '.');
    const file = path.join(root, CONFIG_FILE);
    const content = WORKSPACE_TEMPLATE
      .replace('{{protocol}}', options.protocol);

    if(!options.force && await pathExists(file)) {
      throw new UsageError('Refusing to overwrite existing files ' +
        '(use --force):', {details: [displayPath(file, cwd)]});
    }

    if(!dryRun) {
      await fs.mkdir(path.join(root, GROUPS_DIR), {recursive: true});
      await fs.writeFile(file, content);
    }

    return {
      data: {root, files: [CONFIG_FILE]},
      context: {file, content}
    };
  },

  text: {
    end({context, dryRun}, {c, verbose}) {
      const lines = [];
      const verb = dryRun ? c.cyan('would write') : 'wrote';
      lines.push(`${verb} ${context.file}`);
      if(dryRun && verbose) {
        lines.push(c.dim(context.content.replace(/^/gm, '  ')));
      }
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
