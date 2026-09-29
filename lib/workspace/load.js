/**
 * Workspace loading: reads `mpm.yaml` and `mpm.d/*.yaml` and builds the
 * normalized workspace model.
 */
import {
  CONFIG_FILE, GROUP_ID_PATTERN, GROUPS_DIR, listGroupFiles, readYamlFile
} from '../config/files.js';
import {refToName, resolveRepoUrl} from '../repos/source.js';
import {ConfigError} from '../errors.js';
import path from 'node:path';
import {validateConfig} from '../config/schema.js';

export const DEFAULT_SETTINGS = Object.freeze({
  jobs: 8,
  protocol: 'ssh',
  layout: 'flat'
});

const REPO_NAME_PATTERN = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;

/**
 * @typedef {object} Repo
 * @property {string} name - Unique name, also the checkout directory name.
 * @property {string} group - Group id.
 * @property {string} url - Clone URL.
 * @property {string} path - Absolute checkout path.
 * @property {string} relPath - Checkout path relative to the workspace.
 * @property {boolean} enabled - Effective enabled state (repo and group).
 * @property {boolean} repoEnabled - The repo's own enabled flag.
 * @property {boolean} groupEnabled - The group's enabled flag.
 * @property {string[]} tags - Repo tags plus inherited group tags.
 * @property {string} [description] - Description.
 * @property {number} index - Position in workspace order.
 */

/**
 * @typedef {object} Group
 * @property {string} id - Group id (file name without extension).
 * @property {string} file - Absolute config file path.
 * @property {string} [title] - Display title.
 * @property {string} [description] - Description.
 * @property {string} [source] - Base for short repo names.
 * @property {boolean} enabled - Enabled flag.
 * @property {string[]} tags - Group tags.
 * @property {string[]} repos - Names of repos in this group.
 */

/**
 * @typedef {object} Workspace
 * @property {string} root - Absolute workspace root.
 * @property {string} configFile - Absolute path of `mpm.yaml`.
 * @property {string} groupsDir - Absolute path of `mpm.d`.
 * @property {object} settings - Effective settings.
 * @property {object} aliases - Command aliases.
 * @property {Group[]} groups - Groups in file name order.
 * @property {Repo[]} repos - Repos in workspace order.
 */

/**
 * Load a workspace.
 *
 * @param {object} options - Options.
 * @param {string} options.root - Workspace root directory.
 *
 * @returns {Promise<Workspace>} The workspace model.
 */
export async function loadWorkspace({root}) {
  const configFile = path.join(root, CONFIG_FILE);
  const groupsDir = path.join(root, GROUPS_DIR);

  const {data} = await readYamlFile(configFile, {displayPath: CONFIG_FILE});
  const config = data ?? {};
  const configErrors = validateConfig('workspace', config);
  if(configErrors.length > 0) {
    throw new ConfigError(`Invalid "${CONFIG_FILE}".`,
      {details: configErrors});
  }
  const settings = {...DEFAULT_SETTINGS, ...config.settings};

  const errors = [];
  const groups = [];
  const repos = [];
  const byName = new Map();

  for(const {id, file} of await listGroupFiles(groupsDir)) {
    const displayPath = path.relative(root, file);
    if(!GROUP_ID_PATTERN.test(id)) {
      errors.push(`${displayPath}: invalid group file name "${id}"`);
      continue;
    }
    const {data: groupData} = await readYamlFile(file, {displayPath});
    const groupConfig = groupData ?? {};
    const groupErrors = validateConfig('group', groupConfig);
    if(groupErrors.length > 0) {
      errors.push(...groupErrors.map(e => `${displayPath}: ${e}`));
      continue;
    }

    const group = {
      id,
      file,
      title: groupConfig.title,
      description: groupConfig.description,
      source: groupConfig.source,
      enabled: groupConfig.enabled ?? true,
      tags: groupConfig.tags ?? [],
      repos: []
    };
    groups.push(group);

    for(const [i, entry] of (groupConfig.repos ?? []).entries()) {
      const where = `${displayPath}: /repos/${i}`;
      const normalized = normalizeRepoEntry(entry);
      if(!REPO_NAME_PATTERN.test(normalized.name) ||
        normalized.name === '.' || normalized.name === '..') {
        errors.push(`${where}: invalid repo name "${normalized.name}"; ` +
          'set "name" explicitly');
        continue;
      }
      const url = resolveRepoUrl({
        ref: normalized.ref,
        source: group.source,
        protocol: settings.protocol,
        root
      });
      if(!url) {
        errors.push(`${where}: can not resolve a URL for ` +
          `"${normalized.ref}"; set the group "source" or the repo "url"`);
        continue;
      }
      const existing = byName.get(normalized.name);
      if(existing) {
        errors.push(`${where}: duplicate repo name "${normalized.name}" ` +
          `(also in group "${existing.group}")`);
        continue;
      }
      const relPath = repoRelPath({name: normalized.name, settings});
      const repo = {
        name: normalized.name,
        group: id,
        url,
        path: path.join(root, relPath),
        relPath,
        enabled: group.enabled && normalized.enabled,
        repoEnabled: normalized.enabled,
        groupEnabled: group.enabled,
        tags: [...new Set([...group.tags, ...normalized.tags])],
        description: normalized.description,
        index: repos.length
      };
      repos.push(repo);
      byName.set(repo.name, repo);
      group.repos.push(repo.name);
    }
  }

  if(errors.length > 0) {
    throw new ConfigError('Invalid group config.', {details: errors});
  }

  return {
    root,
    configFile,
    groupsDir,
    settings,
    aliases: config.aliases ?? {},
    groups,
    repos
  };
}

/**
 * Compute a repo's checkout path relative to the workspace root. All layout
 * decisions go through here.
 *
 * @param {object} options - Options.
 * @param {string} options.name - Repo name.
 * @param {object} options.settings - Workspace settings.
 *
 * @returns {string} Relative path.
 */
export function repoRelPath({name, settings}) {
  switch(settings.layout) {
    case 'flat':
      return name;
    default:
      throw new ConfigError(`Unsupported layout "${settings.layout}".`);
  }
}

function normalizeRepoEntry(entry) {
  if(typeof entry === 'string') {
    return {
      ref: entry, name: refToName(entry), enabled: true, tags: []
    };
  }
  return {
    ref: entry.url ?? entry.name,
    name: entry.name ?? refToName(entry.url),
    enabled: entry.enabled ?? true,
    tags: entry.tags ?? [],
    description: entry.description
  };
}
