/**
 * Repo reference and group source resolution.
 *
 * A group `source` is a base location that short repo names are resolved
 * against:
 *
 * - `github:owner` (also `gitlab:`, `codeberg:`): protocol neutral host
 *   shorthand, expanded using the `protocol` setting (ssh or https).
 * - `git@host:owner`: scp-like ssh.
 * - `https://host/owner`, `ssh://git@host/owner`, `file:///dir`: URLs.
 * - `/dir` or `./dir`: a local directory (relative to the workspace root).
 *
 * A repo reference is one of:
 *
 * - `name`: resolved as `<source>/<name>.git`.
 * - `owner/name`: same host and protocol as the source, different owner.
 * - a full URL, host shorthand with path (`github:owner/name`), or local
 *   path: used as is.
 */
import path from 'node:path';

export const HOSTS = Object.freeze({
  github: 'github.com',
  gitlab: 'gitlab.com',
  codeberg: 'codeberg.org'
});

const HOST_SHORTHAND = /^([a-z]+):(?!\/\/)(.+)$/;
const SCP_LIKE = /^([\w.+-]+@)?([\w.-]+):(?!\/\/)(.*)$/;
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Parse a source or full reference into a structured location.
 *
 * @param {string} source - Source string.
 * @param {object} options - Options.
 * @param {string} options.root - Workspace root for relative local paths.
 *
 * @returns {object} Parsed location: `{kind, host, prefix, path}`.
 */
export function parseLocation(source, {root}) {
  const trimmed = source.trim().replace(/\/+$/, '');

  const shorthand = trimmed.match(HOST_SHORTHAND);
  if(shorthand && HOSTS[shorthand[1]]) {
    return {kind: 'host', host: HOSTS[shorthand[1]], path: shorthand[2]};
  }

  if(URL_LIKE.test(trimmed)) {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/^\/+/, '');
    url.pathname = '/';
    let prefix = url.href;
    if(url.protocol === 'file:') {
      prefix = 'file:///';
    }
    return {kind: 'url', prefix, path: decodeURIComponent(pathname)};
  }

  // local paths are checked before scp-like so `./a:b` is not misread
  if(isLocalPath(trimmed)) {
    return {kind: 'path', path: path.resolve(root, expandHome(trimmed))};
  }

  const scp = trimmed.match(SCP_LIKE);
  if(scp) {
    return {kind: 'scp', prefix: `${scp[1] ?? ''}${scp[2]}:`, path: scp[3]};
  }

  // anything else is treated as a relative local path
  return {kind: 'path', path: path.resolve(root, trimmed)};
}

/**
 * Format a parsed location as a git clonable URL.
 *
 * @param {object} location - Parsed location.
 * @param {object} options - Options.
 * @param {string} options.protocol - 'ssh' or 'https' for host shorthand.
 *
 * @returns {string} The URL.
 */
export function formatLocation(location, {protocol}) {
  switch(location.kind) {
    case 'host':
      return protocol === 'https' ?
        `https://${location.host}/${location.path}` :
        `git@${location.host}:${location.path}`;
    case 'scp':
    case 'url':
      return `${location.prefix}${location.path}`;
    case 'path':
      return location.path;
    default:
      throw new TypeError(`Unknown location kind "${location.kind}".`);
  }
}

/**
 * Check whether a repo reference is a complete location rather than a name
 * relative to a group source.
 *
 * @param {string} ref - Repo reference.
 *
 * @returns {boolean} True if the reference is a full location.
 */
export function isFullRef(ref) {
  const shorthand = ref.match(HOST_SHORTHAND);
  if(shorthand && HOSTS[shorthand[1]]) {
    return true;
  }
  return URL_LIKE.test(ref) || isLocalPath(ref) || SCP_LIKE.test(ref);
}

/**
 * Derive the default repo name (and so checkout directory) from a
 * reference.
 *
 * @param {string} ref - Repo reference.
 *
 * @returns {string} The name.
 */
export function refToName(ref) {
  const trimmed = ref.trim().replace(/\/+$/, '');
  const last = trimmed.split(/[/:]/).pop();
  return last.replace(/\.git$/, '');
}

/**
 * Resolve a repo reference to a clonable URL.
 *
 * @param {object} options - Options.
 * @param {string} options.ref - Repo reference.
 * @param {string} [options.source] - Group source.
 * @param {string} options.protocol - 'ssh' or 'https'.
 * @param {string} options.root - Workspace root.
 *
 * @returns {string|undefined} The URL, or undefined if it can not be
 *   resolved because there is no source.
 */
export function resolveRepoUrl({ref, source, protocol, root}) {
  if(isFullRef(ref)) {
    return formatLocation(parseLocation(ref, {root}), {protocol});
  }
  if(!source) {
    return undefined;
  }
  const base = parseLocation(source, {root});
  const relative = ref.replace(/^\/+|\/+$/g, '');
  let joined;
  if(relative.includes('/')) {
    // `owner/name`: sibling of the source's last path segment
    const parent = path.posix.dirname(base.path);
    joined = parent === '.' ? relative : path.posix.join(parent, relative);
  } else {
    joined = base.path ? `${base.path}/${relative}` : relative;
  }
  const location = {...base, path: joined};
  // local directories may hold `name` or `name.git`; git tries both
  if(location.kind !== 'path' && !joined.endsWith('.git')) {
    location.path += '.git';
  }
  return formatLocation(location, {protocol});
}

function isLocalPath(value) {
  return value.startsWith('/') || value.startsWith('./') ||
    value.startsWith('../') || value === '.' || value === '..' ||
    value.startsWith('~/');
}

function expandHome(value) {
  if(value.startsWith('~/')) {
    return path.join(process.env.HOME ?? '', value.slice(2));
  }
  return value;
}

/**
 * Reduce a URL to host and path for comparing repos across protocols.
 *
 * @param {string} url - Git URL.
 *
 * @returns {string} Comparison key.
 */
export function urlKey(url) {
  let key = url.trim().replace(/\/+$/, '').replace(/\.git$/, '');
  const scp = key.match(/^(?:[\w.+-]+@)?([\w.-]+):(?!\/\/)(.*)$/);
  if(scp) {
    return `${scp[1]}/${scp[2]}`.toLowerCase();
  }
  try {
    const parsed = new URL(key);
    if(parsed.protocol !== 'file:') {
      key = `${parsed.hostname}${parsed.pathname}`;
    } else {
      key = parsed.pathname;
    }
  } catch {
    // local path
  }
  return key.toLowerCase();
}

/**
 * Get the GitHub owner (user or org) a group source points at.
 *
 * @param {string} source - Group source.
 * @param {object} options - Options.
 * @param {string} options.root - Workspace root.
 *
 * @returns {string|null} Owner, or null if the source is not a GitHub
 *   owner.
 */
export function githubOwner(source, {root}) {
  if(!source) {
    return null;
  }
  const location = parseLocation(source, {root});
  let host;
  if(location.kind === 'host') {
    host = location.host;
  } else if(location.kind === 'scp') {
    host = location.prefix.replace(/^.*@/, '').replace(/:$/, '');
  } else if(location.kind === 'url') {
    host = new URL(location.prefix).hostname;
  }
  if(host !== 'github.com' || !/^[A-Za-z0-9_.-]+$/.test(location.path)) {
    return null;
  }
  return location.path;
}
