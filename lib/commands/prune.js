/**
 * `mpm prune`: remove stale remote tracking branches.
 */
import {repoLine, summaryText} from '../output/format.js';
import {isCloned} from '../repos/select.js';
import {skipped} from '../run/runner.js';

export default {
  name: 'prune',
  summary: 'Remove remote tracking branches deleted on the remote',
  description: 'Run `git remote prune <remote>` in each selected repo. With ' +
    '--dry-run, `git remote prune --dry-run` is run to show what would be ' +
    'pruned.',
  selection: true,
  positionalRepos: true,
  progress: true,
  options: [
    {flags: '--remote <name>', description: 'remote name', default: 'origin'}
  ],

  async run({runRepos, options, dryRun}) {
    const results = await runRepos(async (repo, context) => {
      if(!await isCloned(repo)) {
        return skipped('missing');
      }
      const remotes = await context.run('git', ['remote']);
      if(!remotes.stdout.split('\n').includes(options.remote)) {
        return skipped(`no remote "${options.remote}"`);
      }
      // git has its own dry run, which is read-only
      const result = await context.run('git', ['remote', 'prune',
        ...dryRun ? ['--dry-run'] : [], options.remote]);
      const refs = [...result.stdout.matchAll(
        /^\s*\* \[(?:would prune|pruned)\] (.+)$/gm)].map(m => m[1]);
      return {refs};
    });
    return {results};
  },

  text: {
    repo(result, context) {
      const {c, dryRun, verbose} = context;
      if(result.status === 'ok') {
        const {refs} = result.data;
        if(refs.length === 0) {
          return verbose ? repoLine(result, context, c.dim('nothing')) :
            undefined;
        }
        return [
          repoLine(result, context, dryRun ?
            c.cyan(`would prune ${refs.length}`) : `pruned ${refs.length}`),
          ...refs.map(ref => c.dim(`  ${ref}`))
        ].join('\n');
      }
      if(result.reason === 'missing' && !verbose) {
        return;
      }
      return repoLine(result, context);
    },

    end(report, context) {
      if(context.quiet && report.exitCode === 0) {
        return;
      }
      const refs = report.results
        .reduce((sum, r) => sum + (r.data?.refs?.length ?? 0), 0);
      return summaryText(report, context, {
        parts: [`${refs} ref${refs === 1 ? '' : 's'} ` +
          (context.dryRun ? 'to prune' : 'pruned')]
      });
    }
  }
};
