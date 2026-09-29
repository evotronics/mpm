/**
 * User defined command aliases from `mpm.yaml`. For example, `aliases:`
 * with `up: pull --rebase`, `outdated: npm outdated`, and
 * `tig: [exec, --interactive, --, tig]`.
 *
 * An alias is expanded in place of the command name, so options before it
 * and arguments after it are kept: `mpm -g core up widget` runs
 * `mpm -g core pull --rebase widget`.
 */
import {CONFIG_FILE, readYamlFile} from '../config/files.js';
import {findWorkspaceRoot} from '../workspace/find.js';
import path from 'node:path';
import {UsageError} from '../errors.js';

// global options that take a separate value
const VALUE_OPTIONS = new Set(['-C', '--workspace', '-j', '--jobs',
  '--output']);
const MAX_DEPTH = 10;

/**
 * Find the index of the command name in argv (the first argument that is
 * not a global option or its value).
 *
 * @param {string[]} argv - Arguments.
 *
 * @returns {number} Index, or -1.
 */
export function commandIndex(argv) {
  for(let i = 0; i < argv.length; ++i) {
    const arg = argv[i];
    if(arg === '--') {
      return -1;
    }
    if(!arg.startsWith('-') || arg === '-') {
      return i;
    }
    if(VALUE_OPTIONS.has(arg)) {
      i++;
    }
  }
  return -1;
}

/**
 * Expand an alias in argv if the command name is not a built-in command.
 *
 * @param {string[]} argv - Arguments.
 * @param {object} options - Options.
 * @param {Set<string>} options.commandNames - Built-in names and aliases.
 * @param {string} options.cwd - Current directory.
 * @param {object} options.env - Environment.
 *
 * @returns {Promise<{argv: string[], aliases: string[]}>} Expanded argv and
 *   the aliases used.
 */
export async function expandAliases(argv, {commandNames, cwd, env}) {
  const index = commandIndex(argv);
  if(index === -1 || commandNames.has(argv[index])) {
    return {argv, aliases: []};
  }
  const aliases = await loadAliases(argv, {cwd, env});
  const used = [];
  let expanded = argv;
  let at = index;
  while(!commandNames.has(expanded[at]) &&
    Object.hasOwn(aliases, expanded[at])) {
    const name = expanded[at];
    if(used.includes(name) || used.length >= MAX_DEPTH) {
      throw new UsageError(`Alias loop: ${[...used, name].join(' -> ')}.`);
    }
    used.push(name);
    const value = aliases[name];
    const words = Array.isArray(value) ? value : splitWords(value);
    if(words.length === 0) {
      throw new UsageError(`Alias "${name}" is empty.`);
    }
    expanded = [...expanded.slice(0, at), ...words, ...expanded.slice(at + 1)];
    // an alias may start with global options
    at = at + commandIndex(words);
  }
  return {argv: expanded, aliases: used};
}

async function loadAliases(argv, {cwd, env}) {
  // honor -C/--workspace given before the command
  let workspace;
  for(let i = 0; i < argv.length; ++i) {
    if(argv[i] === '-C' || argv[i] === '--workspace') {
      workspace = argv[i + 1];
    } else if(argv[i].startsWith('--workspace=')) {
      workspace = argv[i].slice('--workspace='.length);
    }
  }
  try {
    const root = await findWorkspaceRoot({workspace, cwd, env});
    const {data} = await readYamlFile(path.join(root, CONFIG_FILE));
    const aliases = data?.aliases;
    return aliases && typeof aliases === 'object' ? aliases : {};
  } catch {
    // not in a workspace or invalid config: the command will report it
    return {};
  }
}

/**
 * Split a string into words like a shell: whitespace separated, with single
 * quotes, double quotes, and backslash escapes.
 *
 * @param {string} text - Text.
 *
 * @returns {string[]} Words.
 */
export function splitWords(text) {
  const words = [];
  let word = null;
  let quote = null;
  for(let i = 0; i < text.length; ++i) {
    const ch = text[i];
    if(quote) {
      if(ch === quote) {
        quote = null;
      } else if(ch === '\\' && quote === '"' && i + 1 < text.length) {
        word += text[++i];
      } else {
        word += ch;
      }
    } else if(ch === '\'' || ch === '"') {
      quote = ch;
      word ??= '';
    } else if(ch === '\\' && i + 1 < text.length) {
      word = (word ?? '') + text[++i];
    } else if(/\s/.test(ch)) {
      if(word !== null) {
        words.push(word);
        word = null;
      }
    } else {
      word = (word ?? '') + ch;
    }
  }
  if(quote) {
    throw new UsageError(`Unterminated quote in "${text}".`);
  }
  if(word !== null) {
    words.push(word);
  }
  return words;
}
