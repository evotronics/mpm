/**
 * Per-user config: `$XDG_CONFIG_HOME/mpm/config.yaml` (default
 * `~/.config/mpm/config.yaml`), or the file named by `MPM_USER_CONFIG`.
 *
 * It holds personal defaults for all workspaces, such as the clone protocol
 * and parallelism, plus personal command aliases.
 */
import {ConfigError} from '../errors.js';
import os from 'node:os';
import path from 'node:path';
import {pathExists} from '../util/fs.js';
import {readYamlFile} from './files.js';
import {validateConfig} from './schema.js';

/**
 * Path of the user config file.
 *
 * @param {object} [env] - Environment.
 *
 * @returns {string} Absolute path (the file may not exist).
 */
export function userConfigFile(env = process.env) {
  if(env.MPM_USER_CONFIG) {
    return path.resolve(env.MPM_USER_CONFIG);
  }
  const base = env.XDG_CONFIG_HOME || path.join(env.HOME || os.homedir(),
    '.config');
  return path.join(base, 'mpm', 'config.yaml');
}

/**
 * Load the user config. A missing file is an empty config.
 *
 * @param {object} [options] - Options.
 * @param {object} [options.env] - Environment.
 * @param {Map<string, string|null>} [options.overrides] - Pending file
 *   contents by absolute path.
 *
 * @returns {Promise<{file: string, exists: boolean, settings: object,
 *   aliases: object}>} User config.
 */
export async function loadUserConfig({
  env = process.env, overrides = new Map()
} = {}) {
  const file = userConfigFile(env);
  const override = overrides.get(file);
  const exists = override === undefined ? await pathExists(file) :
    override !== null;
  if(!exists) {
    return {file, exists, settings: {}, aliases: {}};
  }
  const displayPath = displayUserPath(file, env);
  const {data} = await readYamlFile(file, {
    displayPath, text: override ?? undefined
  });
  const config = data ?? {};
  const errors = validateConfig('user', config);
  if(errors.length > 0) {
    throw new ConfigError(`Invalid "${displayPath}".`, {details: errors});
  }
  return {
    file,
    exists,
    settings: config.settings ?? {},
    aliases: config.aliases ?? {}
  };
}

/**
 * Show a path under the home directory with `~`.
 *
 * @param {string} file - Absolute path.
 * @param {object} [env] - Environment.
 *
 * @returns {string} Display path.
 */
export function displayUserPath(file, env = process.env) {
  const home = env.HOME || os.homedir();
  return home && file.startsWith(home + path.sep) ?
    '~' + file.slice(home.length) : file;
}
