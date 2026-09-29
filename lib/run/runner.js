/**
 * Parallel per-repo task runner.
 *
 * All side effects go through the per-repo context's `run()` so dry run is
 * handled in one place: actions marked `mutates` are recorded but not
 * executed.
 */
import {formatCommand, spawnProcess} from './exec.js';
import {ExecError} from '../errors.js';
import PQueue from 'p-queue';

/**
 * @typedef {object} RepoResult
 * @property {object} repo - The repo.
 * @property {'ok'|'skipped'|'failed'} status - Outcome.
 * @property {string} [reason] - Short reason for skipped or failed.
 * @property {object} [data] - Command specific data.
 * @property {Error} [error] - Error for failed results.
 * @property {object[]} actions - Commands run (or that would be run).
 * @property {number} [durationMs] - Time taken.
 */

/**
 * Create a skipped result for a task to return.
 *
 * @param {string} reason - Why it was skipped.
 * @param {object} [data] - Extra data.
 *
 * @returns {object} Partial result.
 */
export function skipped(reason, data) {
  return {status: 'skipped', reason, data};
}

/**
 * Create a failed result for a task to return (instead of throwing).
 *
 * @param {string} reason - Why it failed.
 * @param {object} [data] - Extra data.
 *
 * @returns {object} Partial result.
 */
export function failed(reason, data) {
  return {status: 'failed', reason, data};
}

/**
 * Run a task for each repo with limited concurrency.
 *
 * @param {object} options - Options.
 * @param {object[]} options.repos - Repos to process.
 * @param {Function} options.task - `async (repo, repoContext) => result`.
 *   Return data (status ok), or `skipped()`/`failed()`; throwing marks the
 *   repo failed.
 * @param {number} [options.jobs] - Concurrency.
 * @param {boolean} [options.dryRun] - Do not run mutating actions.
 * @param {boolean} [options.failFast] - Skip remaining repos after a
 *   failure.
 * @param {boolean} [options.interactive] - Run one at a time with inherited
 *   stdio.
 * @param {AbortSignal} [options.signal] - Abort signal.
 * @param {object} [options.env] - Environment for child processes.
 * @param {object} [options.renderer] - Receives `repoStart`/`repoDone`.
 *
 * @returns {Promise<RepoResult[]>} Results in repo order.
 */
export async function runRepos({
  repos, task, jobs = 1, dryRun = false, failFast = false,
  interactive = false, signal, env = process.env, renderer
}) {
  const results = new Array(repos.length);
  const queue = new PQueue({concurrency: interactive ? 1 : jobs});
  let anyFailed = false;

  await Promise.all(repos.map((repo, index) => queue.add(async () => {
    let result;
    if(signal?.aborted || failFast && anyFailed) {
      result = {
        repo,
        status: 'skipped',
        reason: signal?.aborted ? 'interrupted' : 'fail-fast',
        actions: []
      };
    } else {
      renderer?.repoStart?.(index, repo);
      const context = createRepoContext({
        repo, dryRun, interactive, signal, env
      });
      const start = performance.now();
      try {
        result = normalizeResult(await task(repo, context));
      } catch(error) {
        result = {
          status: 'failed',
          reason: signal?.aborted ? 'interrupted' : error.message,
          error
        };
      }
      result.repo = repo;
      result.actions = context.actions;
      result.durationMs = Math.round(performance.now() - start);
      if(result.status === 'failed') {
        anyFailed = true;
      }
    }
    results[index] = result;
    renderer?.repoDone?.(index, result);
  })));

  return results;
}

/**
 * Create the per-repo context passed to tasks.
 *
 * @param {object} options - Options.
 * @param {object} options.repo - Repo.
 * @param {boolean} options.dryRun - Dry run.
 * @param {boolean} options.interactive - Interactive mode.
 * @param {AbortSignal} [options.signal] - Abort signal.
 * @param {object} options.env - Environment.
 *
 * @returns {object} Context with `run()` and `actions`.
 */
export function createRepoContext({repo, dryRun, interactive, signal, env}) {
  const actions = [];
  return {
    repo,
    dryRun,
    actions,
    /**
     * Perform a state changing action that is not a process, such as
     * removing a directory. Skipped in dry run mode.
     *
     * @param {string} label - Description, e.g. "remove node_modules".
     * @param {Function} fn - `async () => result`.
     *
     * @returns {Promise<*>} The function result, or undefined in dry run.
     */
    async action(label, fn) {
      const action = {label, mutates: true, dryRun};
      actions.push(action);
      if(dryRun) {
        return undefined;
      }
      return fn();
    },
    /**
     * Run a command.
     *
     * @param {string} cmd - Command.
     * @param {string[]} args - Arguments.
     * @param {object} [options] - Options.
     * @param {boolean} [options.mutates] - True if this changes state; not
     *   run in dry run mode.
     * @param {string} [options.cwd] - Working directory (default repo path).
     * @param {number[]} [options.allowExitCodes] - Non-error exit codes.
     * @param {boolean} [options.interactive] - Inherit stdio.
     * @param {object} [options.env] - Extra environment variables.
     *
     * @returns {Promise<import('./exec.js').ExecResult>} Result.
     */
    async run(cmd, args, {
      mutates = false, cwd = repo.path, allowExitCodes = [0],
      interactive: runInteractive = interactive, env: extraEnv
    } = {}) {
      const action = {cmd, args, cwd, mutates, dryRun: dryRun && mutates};
      actions.push(action);
      if(action.dryRun) {
        return {code: 0, signal: null, stdout: '', stderr: '', output: '',
          dryRun: true};
      }
      const result = await spawnProcess(cmd, args, {
        cwd,
        env: {
          // never block on credential prompts in parallel runs
          ...(runInteractive ? {} : {GIT_TERMINAL_PROMPT: '0'}),
          ...env,
          ...extraEnv
        },
        signal,
        interactive: runInteractive
      });
      action.exitCode = result.code;
      if(!allowExitCodes.includes(result.code)) {
        const command = `\`${formatCommand(cmd, args)}\``;
        const status = result.signal ? `was killed by ${result.signal}` :
          `exited with code ${result.code}`;
        const detail = errorSummary(result.stderr);
        const message = `${command} ${status}` + (detail ? `: ${detail}` : '');
        throw new ExecError(message, {result});
      }
      return result;
    }
  };
}

/**
 * Pick the most useful line of error output: the first `fatal:` or
 * `error:` line (as git prints), otherwise the last line.
 *
 * @param {string} stderr - Error output.
 *
 * @returns {string} Summary line, or '' if there is no output.
 */
export function errorSummary(stderr) {
  const lines = stderr.split('\n').map(l => l.trim()).filter(Boolean);
  return lines.find(l => /^(fatal|error):/i.test(l)) ?? lines.at(-1) ?? '';
}

function normalizeResult(value) {
  if(value && typeof value === 'object' && 'status' in value) {
    return {...value};
  }
  return {status: 'ok', data: value};
}
