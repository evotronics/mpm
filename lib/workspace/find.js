/**
 * Workspace discovery.
 *
 * A workspace config can define aliases that run arbitrary commands, so an
 * `mpm.yaml` found by walking up from the current directory is only used if
 * its directory is trusted: listed in the user config's `trusted` list
 * (see `mpm trust`). Any `mpm.yaml` in a cloned repo would otherwise take
 * over when running mpm inside that repo. A workspace chosen explicitly
 * with `-C` or `MPM_WORKSPACE` is always used.
 */
import {CONFIG_FILE} from '../config/files.js';
import fs from 'node:fs/promises';
import {loadUserConfig} from '../config/user.js';
import {MpmError} from '../errors.js';
import os from 'node:os';
import path from 'node:path';
import {pathExists} from '../util/fs.js';

/**
 * Find the workspace.
 *
 * Order: explicit `workspace` option, `MPM_WORKSPACE` environment variable,
 * then the nearest trusted directory at or above `cwd` holding `mpm.yaml`.
 * Untrusted `mpm.yaml` files passed on the way are reported in `skipped`.
 *
 * @param {object} [options] - Options.
 * @param {string} [options.workspace] - Explicit workspace directory.
 * @param {string} [options.cwd] - Directory to start searching from.
 * @param {object} [options.env] - Environment variables.
 *
 * @returns {Promise<{root: string, skipped: string[]}>} Absolute workspace
 *   root and skipped untrusted workspace directories.
 */
export async function findWorkspace({
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
    return {root, skipped: []};
  }

  const {trusted} = await loadUserConfig({env});
  const trustedPaths = await Promise.all(
    trusted.map(entry => trustPath(entry, {cwd, env})));
  const skipped = [];
  let dir = path.resolve(cwd);
  while(true) {
    if(await pathExists(path.join(dir, CONFIG_FILE))) {
      if(trustedPaths.includes(await realpathOrSelf(dir))) {
        return {root: dir, skipped};
      }
      skipped.push(dir);
    }
    const parent = path.dirname(dir);
    if(parent === dir) {
      break;
    }
    dir = parent;
  }
  if(skipped.length > 0) {
    throw new MpmError(`Untrusted workspace "${skipped[0]}".`, {
      code: 'UNTRUSTED_WORKSPACE',
      details: [
        'Workspace configs can run commands (aliases), so they are only',
        'loaded automatically from trusted directories. If you trust it:',
        `  mpm trust "${skipped[0]}"`,
        `or use it once with: mpm -C "${skipped[0]}" ...`
      ]
    });
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

/**
 * Find the workspace root. See `findWorkspace()`.
 *
 * @param {object} [options] - Options for `findWorkspace()`.
 *
 * @returns {Promise<string>} Absolute workspace root.
 */
export async function findWorkspaceRoot(options) {
  return (await findWorkspace(options)).root;
}

/**
 * Normalize a directory for the trusted list: absolute, `~` expanded, and
 * with symlinks resolved.
 *
 * @param {string} dir - Directory.
 * @param {object} [options] - Options.
 * @param {string} [options.cwd] - Base for relative paths.
 * @param {object} [options.env] - Environment, for `~`.
 *
 * @returns {Promise<string>} Normalized path.
 */
export function trustPath(dir, {cwd = process.cwd(), env = process.env} = {}) {
  return realpathOrSelf(path.resolve(cwd, expandHome(dir, env)));
}

async function realpathOrSelf(dir) {
  try {
    return await fs.realpath(dir);
  } catch {
    return path.resolve(dir);
  }
}

function expandHome(dir, env) {
  if(dir === '~' || dir.startsWith('~/')) {
    return path.join(env.HOME || os.homedir(), dir.slice(1));
  }
  return dir;
}
