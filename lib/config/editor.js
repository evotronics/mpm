/**
 * Comment preserving config editing.
 *
 * Edits are made to YAML documents in memory. `commit()` validates the
 * resulting workspace (by loading it with the pending contents) before
 * anything is written, and in dry run mode only reports diffs.
 */
import {CONFIG_FILE, GROUPS_DIR, parseYaml, stringifyYaml} from './files.js';
import {ConfigError} from '../errors.js';
import {createTwoFilesPatch} from 'diff';
import fs from 'node:fs/promises';
import {loadWorkspace} from '../workspace/load.js';
import path from 'node:path';
import YAML from 'yaml';

export class ConfigEditor {
  /**
   * @param {object} options - Options.
   * @param {string} options.root - Workspace root.
   */
  constructor({root}) {
    this.root = root;
    // file -> {original: string|null, document: Document|null}
    this.files = new Map();
  }

  get configFile() {
    return path.join(this.root, CONFIG_FILE);
  }

  groupFile(id) {
    return path.join(this.root, GROUPS_DIR, `${id}.yaml`);
  }

  /**
   * Get the document for a file, loading it on first use.
   *
   * @param {string} file - Absolute path.
   *
   * @returns {Promise<YAML.Document>} Document.
   */
  async document(file) {
    let entry = this.files.get(file);
    if(!entry) {
      const original = await fs.readFile(file, 'utf8');
      const document = parseYaml(original);
      if(document.errors.length > 0) {
        throw new ConfigError(`Invalid YAML in "${this.display(file)}".`, {
          details: document.errors.map(e => e.message)
        });
      }
      if(!YAML.isMap(document.contents)) {
        document.contents = document.createNode({});
      }
      entry = {original, document};
      this.files.set(file, entry);
    }
    if(!entry.document) {
      throw new ConfigError(`"${this.display(file)}" is being deleted.`);
    }
    return entry.document;
  }

  /**
   * Create a new file.
   *
   * @param {string} file - Absolute path.
   * @param {object} data - Initial data.
   * @param {object} [options] - Options.
   * @param {string} [options.comment] - Comment at the top of the file.
   *
   * @returns {YAML.Document} The new document.
   */
  create(file, data, {comment} = {}) {
    const document = new YAML.Document(data);
    if(comment) {
      document.commentBefore = comment;
    }
    this.files.set(file, {original: null, document});
    return document;
  }

  /**
   * Delete a file.
   *
   * @param {string} file - Absolute path.
   */
  async remove(file) {
    const original = this.files.get(file)?.original ??
      await fs.readFile(file, 'utf8');
    this.files.set(file, {original, document: null});
  }

  /**
   * Pending changes.
   *
   * @returns {Array<{file: string, before: string|null, after: string|null}>}
   *   Changed files; null content means the file does not exist.
   */
  changes() {
    const changes = [];
    for(const [file, {original, document}] of this.files) {
      const after = document ? stringifyYaml(document) : null;
      if(after !== original) {
        changes.push({file, before: original, after});
      }
    }
    return changes.sort((a, b) => a.file.localeCompare(b.file));
  }

  /**
   * Validate and (unless dry run) write pending changes.
   *
   * @param {object} [options] - Options.
   * @param {boolean} [options.dryRun] - Do not write.
   *
   * @returns {Promise<{changes: object[], workspace: object}>} Changes
   *   with `path` (relative), `action`, and `diff`, and the resulting
   *   workspace.
   */
  async commit({dryRun = false} = {}) {
    const changes = this.changes();
    const overrides = new Map(changes.map(c => [c.file, c.after]));
    // throws ConfigError if the result would be invalid
    const workspace = await loadWorkspace({root: this.root, overrides});
    if(!dryRun) {
      for(const {file, after} of changes) {
        if(after === null) {
          await fs.rm(file);
        } else {
          await fs.mkdir(path.dirname(file), {recursive: true});
          await fs.writeFile(file, after);
        }
      }
    }
    return {workspace, changes: changes.map(change => {
      const display = this.display(change.file);
      return {
        path: display,
        action: change.before === null ? 'create' :
          change.after === null ? 'delete' : 'update',
        diff: createTwoFilesPatch(
          change.before === null ? '/dev/null' : `a/${display}`,
          change.after === null ? '/dev/null' : `b/${display}`,
          change.before ?? '', change.after ?? '', '', '', {context: 2})
          .replace(/^=+\n/, '')
      };
    })};
  }

  display(file) {
    return path.relative(this.root, file);
  }
}
