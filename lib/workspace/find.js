/**
 * Workspace discovery.
 */
import {CONFIG_FILE} from '../config/files.js';
import {MpmError} from '../errors.js';
import path from 'node:path';
import {pathExists} from '../util/fs.js';

/**
 * Find the workspace root.
 *
 * Order: explicit `workspace` option, `MPM_WORKSPACE` environment variable,
 * then the nearest directory at or above `cwd` holding `mpm.yaml`.
 *
 * @param {object} [options] - Options.
 * @param {string} [options.workspace] - Explicit workspace directory.
 * @param {string} [options.cwd] - Directory to start searching from.
 * @param {object} [options.env] - Environment variables.
 *
 * @returns {Promise<string>} Absolute workspace root.
 */
export async function findWorkspaceRoot({
  workspace, cwd = process.cwd(), env = process.env
} = {}) {
  const explicit = workspace ?? env.MPM_WORKSPACE;
  if(explicit) {
    const root = path.resolve(cwd, explicit);
    if(!await pathExists(path.join(root, CONFIG_FILE))) {
      throw new MpmError(`No "${CONFIG_FILE}" found in "${root}".`, {
        code: 'NO_WORKSPACE',
        details: [`Create one with: mpm init "${root}"`]
      });
    }
    return root;
  }

  let dir = path.resolve(cwd);
  while(true) {
    if(await pathExists(path.join(dir, CONFIG_FILE))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if(parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new MpmError(
    `Not in an mpm workspace (no "${CONFIG_FILE}" in "${cwd}" or any ` +
    'parent directory).', {
      code: 'NO_WORKSPACE',
      details: [
        'Use -C <dir> or MPM_WORKSPACE to choose a workspace, or create one ' +
        'with: mpm init'
      ]
    });
}
