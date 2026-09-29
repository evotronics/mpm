/**
 * Shell completion engine, used by the hidden `mpm __complete` command
 * that the scripts from `mpm completion <shell>` call.
 *
 * Given the words typed after `mpm` (the last one being the word under the
 * cursor, possibly empty), returns candidate lines: `value` or
 * `value<TAB>description`. The special single line `__files__` or
 * `__dirs__` asks the shell for its own file or directory completion.
 */
import {DEFAULT_SETTINGS, loadWorkspace} from '../workspace/load.js';
import {findWorkspaceRoot} from '../workspace/find.js';
import {loadAliases} from './aliases.js';

/** Command definitions by commander command, set by the CLI builder. */
export const definitions = new WeakMap();

const FILES = ['__files__'];
const DIRS = ['__dirs__'];
const REPO_OPTIONS = new Set(['repo', 'exclude', 'from']);
const TAG_OPTIONS = new Set(['tag', 'add', 'remove']);

/**
 * Compute completions.
 *
 * @param {object} options - Options.
 * @param {object} options.program - Commander program.
 * @param {string[]} options.words - Words after `mpm`; the last is the word
 *   being completed.
 * @param {string} options.cwd - Current directory.
 * @param {object} options.env - Environment.
 *
 * @returns {Promise<string[]>} Candidate lines.
 */
export async function complete({program, words, cwd, env}) {
  const current = words.length > 0 ? words.at(-1) : '';
  const state = walk(program, words.slice(0, -1));
  const data = createDataSource({words, cwd, env});

  if(state.passThrough) {
    return FILES;
  }
  if(state.expectValue) {
    return filter(await optionValues(state.expectValue, current, data),
      current);
  }
  if(current.startsWith('-') && !state.afterDoubleDash) {
    return filter(optionCandidates(state.cmd, program), current);
  }
  const subcommands = visibleCommands(state.cmd);
  if(subcommands.length > 0) {
    const candidates = subcommands.map(c =>
      line(c.name(), c.summary() || c.description()));
    if(state.cmd === program) {
      const aliases = await data.aliases();
      for(const [name, value] of Object.entries(aliases)) {
        candidates.push(line(name, `alias: ${
          Array.isArray(value) ? value.join(' ') : value}`));
      }
    }
    return filter(candidates, current);
  }
  const kind = positionalKind(definitions.get(state.cmd), state.positional);
  return filter(await kindValues(kind, current, data), current);
}

/**
 * Walk the typed words through the command tree.
 *
 * @param {object} program - Commander program.
 * @param {string[]} tokens - Complete words before the cursor.
 *
 * @returns {object} `{cmd, positional, expectValue, passThrough,
 *   afterDoubleDash}`.
 */
function walk(program, tokens) {
  const state = {
    cmd: program, positional: 0, expectValue: null, passThrough: false,
    afterDoubleDash: false
  };
  for(const token of tokens) {
    const definition = definitions.get(state.cmd);
    if(state.passThrough) {
      break;
    }
    if(state.expectValue) {
      state.expectValue = null;
      continue;
    }
    if(token === '--' && !state.afterDoubleDash) {
      if(definition?.passThrough) {
        state.passThrough = true;
      } else {
        state.afterDoubleDash = true;
      }
      continue;
    }
    if(token.startsWith('-') && token !== '-' && !state.afterDoubleDash) {
      const {option, attached} = findOption(state.cmd, token);
      if(option?.required && !attached) {
        state.expectValue = option;
      } else if(!option && definition?.passThrough) {
        // unknown options start the pass-through arguments
        state.passThrough = true;
      }
      continue;
    }
    const sub = state.positional === 0 && visibleCommands(state.cmd)
      .find(c => c.name() === token || c.aliases().includes(token));
    if(sub) {
      state.cmd = sub;
      continue;
    }
    if(definition?.passThrough) {
      state.passThrough = true;
      continue;
    }
    state.positional++;
  }
  return state;
}

function findOption(cmd, token) {
  const [name, value] = token.split(/=(.*)/s);
  let option = cmd.options.find(o => o.long === name || o.short === name);
  if(option) {
    return {option, attached: value !== undefined};
  }
  // short option with an attached value, e.g. -j4
  if(/^-[A-Za-z]./.test(token)) {
    option = cmd.options.find(o => o.short === token.slice(0, 2));
    if(option) {
      return {option, attached: option.required};
    }
  }
  return {option: null, attached: false};
}

function visibleCommands(cmd) {
  return cmd.commands.filter(c => !c._hidden);
}

function optionCandidates(cmd, program) {
  const candidates = [];
  const options = cmd === program ? program.options : cmd.options;
  for(const option of options) {
    for(const flag of [option.long, option.short]) {
      if(flag) {
        candidates.push(line(flag, option.description));
      }
    }
  }
  candidates.push(line('--help', 'display help for command'));
  return candidates;
}

async function optionValues(option, current, data) {
  const name = option.attributeName();
  if(option.argChoices) {
    return option.argChoices.map(value => line(value));
  }
  if(name === 'workspace') {
    return DIRS;
  }
  if(name === 'group') {
    return kindValues('groups', current, data);
  }
  if(TAG_OPTIONS.has(name)) {
    return kindValues(name === 'tag' ? 'tag-expression' : 'tags', current,
      data);
  }
  if(REPO_OPTIONS.has(name)) {
    return kindValues('repos', current, data);
  }
  return [];
}

function positionalKind(definition, index) {
  if(!definition) {
    return null;
  }
  const args = definition.arguments ?? [];
  if(index < args.length) {
    return args[index].complete ?? null;
  }
  if(definition.positionalRepos) {
    return 'repos';
  }
  const last = args.at(-1);
  return last?.name.includes('...') ? last.complete ?? null : null;
}

async function kindValues(kind, current, data) {
  switch(kind) {
    case 'files':
      return FILES;
    case 'dirs':
      return DIRS;
    case 'shells':
      return ['bash', 'zsh', 'fish'].map(shell => line(shell));
    case 'groups': {
      const workspace = await data.workspace();
      return (workspace?.groups ?? []).map(g =>
        line(g.id, g.title ?? (g.enabled ? '' : 'disabled')));
    }
    case 'repos': {
      const workspace = await data.workspace();
      return (workspace?.repos ?? []).map(r =>
        line(r.name, r.enabled ? r.group : `${r.group}, disabled`));
    }
    case 'tags':
      return (await data.tags()).map(tag => line(tag));
    case 'tag-expression': {
      // complete the last tag in expressions like `a,b+!c`
      const prefix = current.match(/^.*[,+!]/)?.[0] ?? '';
      const used = new Set(prefix.split(/[,+!]/));
      return (await data.tags()).filter(tag => !used.has(tag))
        .map(tag => line(prefix + tag));
    }
    case 'config-keys': {
      const workspace = await data.workspace();
      const aliases = workspace?.aliases ?? await data.aliases();
      return [
        ...Object.keys(DEFAULT_SETTINGS).map(key => line(key, 'setting')),
        ...Object.keys(DEFAULT_SETTINGS).map(key => line(`settings.${key}`)),
        ...Object.keys(aliases).map(key => line(`aliases.${key}`))
      ];
    }
    default:
      return [];
  }
}

/**
 * Lazily load workspace data, ignoring errors (completion must never fail
 * loudly).
 *
 * @param {object} options - Options.
 * @param {string[]} options.words - Typed words, for `-C`.
 * @param {string} options.cwd - Current directory.
 * @param {object} options.env - Environment.
 *
 * @returns {object} Data accessors.
 */
function createDataSource({words, cwd, env}) {
  let workspacePromise;
  const workspaceOption = () => {
    for(let i = 0; i < words.length - 1; ++i) {
      if(words[i] === '-C' || words[i] === '--workspace') {
        return words[i + 1];
      }
    }
    return undefined;
  };
  const source = {
    workspace() {
      workspacePromise ??= (async () => {
        try {
          const root = await findWorkspaceRoot({
            workspace: workspaceOption(), cwd, env
          });
          return await loadWorkspace({root, env});
        } catch {
          return null;
        }
      })();
      return workspacePromise;
    },
    async tags() {
      const workspace = await source.workspace();
      const tags = new Set([
        ...workspace?.repos.flatMap(r => r.tags) ?? [],
        ...workspace?.groups.flatMap(g => g.tags) ?? []
      ]);
      return [...tags].sort();
    },
    async aliases() {
      try {
        return await loadAliases(words, {cwd, env});
      } catch {
        return {};
      }
    }
  };
  return source;
}

function line(value, description) {
  return description ? `${value}\t${description.split('\n')[0]}` : value;
}

function filter(candidates, current) {
  if(candidates === FILES || candidates === DIRS) {
    return candidates;
  }
  return candidates.filter(c => c.startsWith(current) && c !== '');
}
