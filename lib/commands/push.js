/**
 * `mpm push`: push selected repos that have local commits.
 */
import {repoLine, summaryText} from '../output/format.js';
import {getStatus} from '../git/status.js';
import {isCloned} from '../repos/select.js';
import {skipped} from '../run/runner.js';

export default {
  name: 'push',
  summary: 'Push selected repos that are ahead of their upstream',
  description: 'Run `git push` in each selected repo whose current branch ' +
    'is ahead of its upstream. Repos with nothing to push, a detached ' +
    'HEAD, or no upstream are skipped. Ahead counts are based on the last ' +
    'fetch.',
  selection: true,
  positionalRepos: true,
  progress: true,

  async run({runRepos}) {
    const results = await runRepos(async (repo, context) => {
      if(!await isCloned(repo)) {
        return skipped('missing');
      }
      const status = await getStatus(context);
      if(status.detached) {
        return skipped('detached HEAD');
      }
      if(!status.upstream) {
        return skipped('no upstream');
      }
      if(status.ahead === 0) {
        return skipped('nothing to push');
      }
      await context.run('git', ['push'], {mutates: true});
      return {branch: status.branch, commits: status.ahead};
    });
    return {results};
  },

  text: {
    repo(result, context) {
      const {c, verbose, dryRun} = context;
      if(result.status === 'ok') {
        const {commits, branch} = result.data;
        const what = `${commits} commit${commits === 1 ? '' : 's'}`;
        return repoLine(result, context,
          (dryRun ? c.cyan(`would push ${what}`) : `pushed ${what}`) +
          c.dim(` (${branch})`));
      }
      if(result.status === 'skipped' && !verbose &&
        ['missing', 'nothing to push'].includes(result.reason)) {
        return;
      }
      return repoLine(result, context);
    },

    end(report, context) {
      if(context.quiet && report.exitCode === 0) {
        return;
      }
      const {ok, skipped: skippedCount} = report.summary;
      const nothing = report.results
        .filter(r => r.reason === 'nothing to push').length;
      return summaryText(report, context, {
        parts: [
          `${ok} ${context.dryRun ? 'to push' : 'pushed'}`,
          `${nothing} with nothing to push`
        ],
        skipped: skippedCount - nothing
      });
    }
  }
};
