/**
 * `mpm grep`: `git grep` across selected repos.
 */
import {EXIT, UsageError} from '../errors.js';
import {isCloned} from '../repos/select.js';
import path from 'node:path';
import {skipped} from '../run/runner.js';
import {stripVTControlCharacters} from 'node:util';

// git grep options that take a separate value argument
const VALUE_OPTIONS = new Set([
  '-A', '-B', '-C', '-e', '-f', '-m', '--after-context', '--before-context',
  '--context', '--max-count', '--max-depth', '--threads'
]);
// options after which output lines no longer start with a file name
const NO_PREFIX_LONG = new Set([
  '--heading', '--no-filename', '--null', '--open-files-in-pager', '--quiet'
]);
const NO_PREFIX_SHORT = new Set(['h', 'z', 'O', 'q']);

export default {
  name: 'grep',
  helpGroup: 'Git commands:',
  summary: 'Run `git grep` in selected repos',
  description: 'Run `git grep` in each selected repo. mpm options must come ' +
    'first; everything from the first `git grep` argument on is passed ' +
    'through unchanged (use `--` to end mpm options explicitly).\n\n' +
    'Output lines are prefixed with each repo\'s path relative to the ' +
    'current directory, so they can be opened by editors. Exit status is 0 ' +
    'if anything matched, 1 if nothing matched, and 2 on errors.\n\n' +
    'Examples:\n' +
    '  mpm grep -n \'foo bar\'\n' +
    '  mpm grep -g core -t \'!archived\' -- -e pattern -- \'*.js\'\n\n' +
    'Global options must come before "grep" or use their long form ' +
    '(--dry-run, --jobs, --json, ...), since short options after "grep" ' +
    'may belong to `git grep`.',
  selection: true,
  passThrough: true,
  shortGlobals: false,
  shortAll: false,
  progress: true,
  arguments: [{name: '<args...>', description: '`git grep` arguments'}],

  async run({runRepos, args, colors, cwd}) {
    if(args.length === 0) {
      throw new UsageError('No pattern given.');
    }
    const prefixMode = !hasNoPrefixOption(args);
    const colorArgs = colors ? ['--color=always'] : [];
    const results = await runRepos(async (repo, context) => {
      if(!await isCloned(repo)) {
        return skipped('missing', {missing: true});
      }
      const result = await context.run('git', ['grep', ...colorArgs, ...args],
        {allowExitCodes: [0, 1]});
      return {
        matched: result.code === 0,
        output: result.stdout,
        prefix: path.relative(cwd, repo.path)
      };
    });
    const matched = results.some(r => r.data?.matched);
    const failed = results.some(r => r.status === 'failed');
    let exitCode = matched ? EXIT.OK : EXIT.FAILED;
    if(failed) {
      exitCode = EXIT.USAGE;
    }
    return {results, exitCode, context: {prefixMode}};
  },

  text: {
    repo(result, {c, args}) {
      if(result.status !== 'ok' || !result.data.matched ||
        hasNoPrefixOption(args)) {
        return;
      }
      return prefixLines(result.data.output, result.data.prefix, c);
    },

    end(report, {c, verbose}) {
      const lines = [];
      if(!report.context.prefixMode) {
        // heading mode: output was held back until the end
        const out = [];
        for(const result of report.results) {
          if(result.status === 'ok' && result.data.matched) {
            out.push(c.bold(c.magenta(result.data.prefix || '.')));
            out.push(result.data.output.replace(/\n$/, ''));
            out.push('');
          }
        }
        lines.push(...out);
      }
      const err = [];
      const missing = report.results.filter(r => r.data?.missing);
      if(missing.length > 0 && verbose) {
        err.push(`${c.yellow('mpm:')} ${missing.length} selected repos are ` +
          `not cloned: ${missing.map(r => r.repo.name).join(', ')}`);
      }
      for(const result of report.results) {
        if(result.status === 'failed') {
          err.push(`${c.red('mpm:')} ${result.repo.name}: ${result.reason}`);
        }
      }
      return {out: lines.join('\n'), err: err.join('\n')};
    }
  },

  json: {
    repo(result) {
      if(result.status !== 'ok') {
        return result.data;
      }
      return {
        matched: result.data.matched,
        output: stripVTControlCharacters(result.data.output)
      };
    }
  }
};

/**
 * Check for `git grep` options that change the output format so that lines
 * no longer start with a file name.
 *
 * @param {string[]} args - `git grep` arguments.
 *
 * @returns {boolean} True if any such option is present.
 */
export function hasNoPrefixOption(args) {
  for(let i = 0; i < args.length; ++i) {
    const arg = args[i];
    if(arg === '--') {
      break;
    }
    if(VALUE_OPTIONS.has(arg)) {
      i++;
      continue;
    }
    if(arg.startsWith('--')) {
      if(NO_PREFIX_LONG.has(arg.split('=')[0])) {
        return true;
      }
    } else if(/^-[a-zA-Z]+$/.test(arg)) {
      for(const flag of arg.slice(1)) {
        if(NO_PREFIX_SHORT.has(flag)) {
          return true;
        }
        // a value option ends the cluster: -e<pattern>, -A3
        if('ABCefm'.includes(flag)) {
          break;
        }
      }
    }
  }
  return false;
}

/**
 * Prefix each `git grep` output line with a repo path.
 *
 * @param {string} output - `git grep` output.
 * @param {string} prefix - Repo path relative to the current directory.
 * @param {object} c - Colors.
 *
 * @returns {string} Prefixed output.
 */
export function prefixLines(output, prefix, c) {
  if(!prefix) {
    return output;
  }
  const colored = c.magenta(prefix + '/');
  return output.split('\n').map(line => {
    const plain = stripVTControlCharacters(line);
    if(plain === '' || plain === '--') {
      return line;
    }
    const binary = line.match(/^Binary file (.*) matches$/);
    if(binary) {
      return `Binary file ${prefix}/${binary[1]} matches`;
    }
    return colored + line;
  }).join('\n');
}
