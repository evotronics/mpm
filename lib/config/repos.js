/**
 * Repo entry editing within a group document.
 *
 * Entries are either a scalar reference (`name`, `owner/name`, URL) or a map
 * (`{name, url, enabled, tags, description}`). Edits keep entries in their
 * shortest form and keep comments attached to the entry.
 */
import {refToName} from '../repos/source.js';
import YAML from 'yaml';

/**
 * Name of a repo entry node.
 *
 * @param {YAML.Node} node - Entry node.
 *
 * @returns {string} Name.
 */
export function entryName(node) {
  if(YAML.isScalar(node)) {
    return refToName(String(node.value));
  }
  const name = node.get('name');
  return name ?? refToName(String(node.get('url')));
}

/**
 * Get the `repos` sequence of a group document, creating it if needed.
 *
 * @param {YAML.Document} document - Group document.
 * @param {object} [options] - Options.
 * @param {boolean} [options.create] - Create if missing.
 *
 * @returns {YAML.YAMLSeq|undefined} Sequence.
 */
export function reposSeq(document, {create = false} = {}) {
  let seq = document.get('repos', true);
  if(!seq && create) {
    seq = document.createNode([]);
    document.set('repos', seq);
  }
  return seq;
}

/**
 * Find a repo entry.
 *
 * @param {YAML.Document} document - Group document.
 * @param {string} name - Repo name.
 *
 * @returns {{seq: YAML.YAMLSeq, index: number, node: YAML.Node}|null}
 *   Location, or null.
 */
export function findEntry(document, name) {
  const seq = reposSeq(document);
  if(!seq) {
    return null;
  }
  const index = seq.items.findIndex(node => entryName(node) === name);
  return index === -1 ? null : {seq, index, node: seq.items[index]};
}

/**
 * Insert a repo entry in alphabetical position (before the first entry that
 * sorts after it).
 *
 * @param {YAML.Document} document - Group document.
 * @param {string|object} entry - Entry data.
 */
export function insertEntry(document, entry) {
  const seq = reposSeq(document, {create: true});
  // `repos: []` from a new group becomes a block list
  seq.flow = false;
  const node = document.createNode(entry);
  flowTags(node);
  const name = entryName(node);
  let index = seq.items.findIndex(
    item => entryName(item).localeCompare(name) > 0);
  if(index === -1) {
    index = seq.items.length;
  }
  seq.items.splice(index, 0, node);
}

/**
 * Remove a repo entry.
 *
 * @param {YAML.Document} document - Group document.
 * @param {string} name - Repo name.
 *
 * @returns {boolean} True if removed.
 */
export function removeEntry(document, name) {
  const found = findEntry(document, name);
  if(!found) {
    return false;
  }
  found.seq.items.splice(found.index, 1);
  return true;
}

/**
 * Update fields of a repo entry, converting between scalar and map forms as
 * needed. A field set to undefined is removed.
 *
 * @param {YAML.Document} document - Group document.
 * @param {string} name - Repo name.
 * @param {Function} update - `data => data` given and returning plain
 *   object data (`{name?, url?, enabled?, tags?, description?}`).
 *
 * @returns {boolean} True if the entry was found.
 */
export function updateEntry(document, name, update) {
  const found = findEntry(document, name);
  if(!found) {
    return false;
  }
  const {seq, index, node} = found;
  const data = YAML.isScalar(node) ? scalarToData(String(node.value)) :
    node.toJSON();
  const next = update({...data});
  for(const key of Object.keys(next)) {
    if(next[key] === undefined ||
      Array.isArray(next[key]) && next[key].length === 0) {
      delete next[key];
    }
  }
  // enabled is the default
  if(next.enabled === true) {
    delete next.enabled;
  }

  const shortForm = toShortForm(next);
  if(shortForm !== undefined) {
    if(YAML.isScalar(node) && node.value === shortForm) {
      return true;
    }
    const scalar = document.createNode(shortForm);
    copyComments(node, scalar);
    seq.items[index] = scalar;
    return true;
  }

  if(YAML.isMap(node)) {
    // update in place to keep key order and comments
    for(const key of Object.keys(data)) {
      if(!(key in next)) {
        node.delete(key);
      }
    }
    for(const [key, value] of Object.entries(next)) {
      if(JSON.stringify(node.get(key)?.toJSON?.() ?? node.get(key)) !==
        JSON.stringify(value)) {
        const valueNode = document.createNode(value);
        if(key === 'tags') {
          valueNode.flow = true;
        }
        node.set(key, valueNode);
      }
    }
    return true;
  }

  const map = document.createNode(next);
  flowTags(map);
  copyComments(node, map);
  seq.items[index] = map;
  return true;
}

/**
 * Build entry data for a new repo, in its shortest form.
 *
 * @param {object} options - Options.
 * @param {string} options.ref - Reference (name, owner/name, or URL).
 * @param {string} [options.name] - Explicit name.
 * @param {boolean} [options.enabled] - Enabled.
 * @param {string[]} [options.tags] - Tags.
 * @param {string} [options.description] - Description.
 *
 * @returns {string|object} Entry data.
 */
export function newEntry({ref, name, enabled = true, tags = [], description}) {
  const data = scalarToData(ref);
  if(name && name !== data.name) {
    if(!data.url) {
      data.url = data.name;
    }
    data.name = name;
  }
  if(!enabled) {
    data.enabled = false;
  }
  if(tags.length > 0) {
    data.tags = tags;
  }
  if(description) {
    data.description = description;
  }
  return toShortForm(data) ?? data;
}

function scalarToData(ref) {
  const name = refToName(ref);
  return ref === name ? {name} : {url: ref};
}

// the scalar form if the data has nothing but a reference
function toShortForm(data) {
  const keys = Object.keys(data);
  if(keys.length === 1 && keys[0] === 'name') {
    return data.name;
  }
  if(keys.length === 1 && keys[0] === 'url') {
    return data.url;
  }
  if(keys.length === 2 && data.url && refToName(data.url) === data.name) {
    return data.url;
  }
  return undefined;
}

function flowTags(node) {
  if(YAML.isMap(node)) {
    const tags = node.get('tags', true);
    if(YAML.isSeq(tags)) {
      tags.flow = true;
    }
  }
}

function copyComments(from, to) {
  to.commentBefore = from.commentBefore;
  to.comment = from.comment;
  to.spaceBefore = from.spaceBefore;
}
