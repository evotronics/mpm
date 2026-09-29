/**
 * Config file names and YAML reading.
 */
import {ConfigError} from '../errors.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

export const CONFIG_FILE = 'mpm.yaml';
export const GROUPS_DIR = 'mpm.d';
export const GROUP_FILE_EXTENSIONS = ['.yaml', '.yml'];
export const GROUP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Read and parse a YAML file.
 *
 * @param {string} file - File path.
 * @param {object} [options] - Options.
 * @param {string} [options.displayPath] - Path to use in error messages.
 *
 * @returns {Promise<{data: *, document: YAML.Document}>} Parsed data (null
 *   for an empty file) and the comment preserving document.
 */
export async function readYamlFile(file, {displayPath = file} = {}) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch(e) {
    throw new ConfigError(`Unable to read "${displayPath}": ${e.message}`,
      {cause: e});
  }
  const document = YAML.parseDocument(text, {prettyErrors: true});
  if(document.errors.length > 0) {
    throw new ConfigError(`Invalid YAML in "${displayPath}".`, {
      details: document.errors.map(e => e.message)
    });
  }
  return {data: document.toJS(), document};
}

/**
 * List group config files in a groups directory, sorted by name.
 *
 * @param {string} dir - Groups directory.
 *
 * @returns {Promise<Array<{id: string, file: string}>>} Group files.
 */
export async function listGroupFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, {withFileTypes: true});
  } catch(e) {
    if(e.code === 'ENOENT') {
      return [];
    }
    throw e;
  }
  const groups = [];
  for(const entry of entries) {
    const extension = path.extname(entry.name);
    if(!entry.isFile() || !GROUP_FILE_EXTENSIONS.includes(extension) ||
      entry.name.startsWith('.')) {
      continue;
    }
    groups.push({
      id: path.basename(entry.name, extension),
      file: path.join(dir, entry.name)
    });
  }
  return groups.sort((a, b) => a.id.localeCompare(b.id));
}
