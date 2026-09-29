/**
 * `mpm clone`: clone selected repos that are not checked out yet.
 */
import {actionLines, errorLines, statusMark, summaryText}
  from '../output/format.js';
import {isCloned} from '../repos/select.js';
import {pathExists} from '../util/fs.js';
import {skipped} from '../run/runner.js';

export default {
  name: 'clone',
  helpGroup: 'Git commands:',
  summary: 'Clone selected repos that are missing',
  description: 'Clone each selected repo that is not checked out yet. ' +
    'Repos that already exist are left alone.',
  selection: true,
  positionalRepos: true,
  progress: true,

  async run({runRepos, workspace}) {
    const results = await runRepos(cloneTask(workspace));
    return {results};
  },

  text: {
    repo(result, context) {
      if(result.status === 'skipped' && !context.verbose) {
        return;
      }
      const {c, dryRun} = context;
      let label;
      if(result.status === 'ok') {
        label = dryRun ? c.cyan('would clone') : 'cloned';
      } else if(result.status === 'skipped') {
        label = c.dim(`skipped: ${result.reason}`);
      } else {
        label = c.red('failed');
      }
      return [
        `${statusMark(result, c)} ${result.repo.name}  ${label}`,
        ...actionLines(result, context),
        ...errorLines(result, context)
      ].join('\n');
    },

    end(report, context) {
      if(context.quiet && report.exitCode === 0) {
        return;
      }
      const {ok, skipped} = report.summary;
      const present = report.results
        .filter(r => r.reason === 'present').length;
      // "present" is the normal case, not worth highlighting as skipped
      return summaryText(report, context, {
        parts: [
          `${ok} ${context.dryRun ? 'to clone' : 'cloned'}`,
          `${present} already present`
        ],
        skipped: skipped - present
      });
    }
  }
};

/**
 * Create the per-repo clone task.
 *
 * @param {object} workspace - Workspace.
 *
 * @returns {Function} Task for `runRepos`.
 */
export function cloneTask(workspace) {
  return async (repo, context) => {
    if(await isCloned(repo)) {
      return skipped('present');
    }
    if(await pathExists(repo.path)) {
      throw new Error(`"${repo.relPath}" exists but is not a git checkout`);
    }
    await context.run('git', ['clone', '--', repo.url, repo.relPath], {
      cwd: workspace.root, mutates: true
    });
    return {cloned: true, url: repo.url};
  };
}
