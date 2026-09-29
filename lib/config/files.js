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
 * @param {string} [options.text] - Use this content instead of reading the
 *   file.
 *
 * @returns {Promise<{data: *, document: YAML.Document, text: string}>}
 *   Parsed data (null for an empty file), the comment preserving document,
 *   and the source text.
 */
export async function readYamlFile(file, {displayPath = file, text} = {}) {
  if(text === undefined) {
    try {
      text = await fs.readFile(file, 'utf8');
    } catch(e) {
      throw new ConfigError(`Unable to read "${displayPath}": ${e.message}`,
        {cause: e});
    }
  }
  const document = parseYaml(text);
  if(document.errors.length > 0) {
    throw new ConfigError(`Invalid YAML in "${displayPath}".`, {
      details: document.errors.map(e => e.message)
    });
  }
  return {data: document.toJS(), document, text};
}

/**
 * Parse YAML text into a comment preserving document.
 *
 * @param {string} text - YAML text.
 *
 * @returns {YAML.Document} Document (check `errors`).
 */
export function parseYaml(text) {
  return YAML.parseDocument(text, {prettyErrors: true});
}

/**
 * Serialize a document, keeping the style used by mpm generated files.
 *
 * @param {YAML.Document} document - Document.
 *
 * @returns {string} YAML text.
 */
export function stringifyYaml(document) {
  return document.toString({lineWidth: 0, flowCollectionPadding: false});
}

/**
 * List group config files in a groups directory, sorted by name.
 *
 * @param {string} dir - Groups directory.
 * @param {object} [options] - Options.
 * @param {Map<string, string|null>} [options.overrides] - Pending file
 *   contents by absolute path; null means deleted. New files in `dir` are
 *   included.
 *
 * @returns {Promise<Array<{id: string, file: string}>>} Group files.
 */
export async function listGroupFiles(dir, {overrides = new Map()} = {}) {
  let entries;
  try {
    entries = await fs.readdir(dir, {withFileTypes: true});
  } catch(e) {
    if(e.code !== 'ENOENT') {
      throw e;
    }
    entries = [];
  }
  const files = new Set(entries.filter(e => e.isFile())
    .map(e => path.join(dir, e.name)));
  for(const [file, text] of overrides) {
    if(path.dirname(file) !== dir) {
      continue;
    }
    if(text === null) {
      files.delete(file);
    } else {
      files.add(file);
    }
  }
  const groups = [];
  for(const file of files) {
    const name = path.basename(file);
    const extension = path.extname(name);
    if(!GROUP_FILE_EXTENSIONS.includes(extension) || name.startsWith('.')) {
      continue;
    }
    groups.push({id: path.basename(name, extension), file});
  }
  return groups.sort((a, b) => a.id.localeCompare(b.id));
}
