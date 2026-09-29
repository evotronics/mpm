/**
 * `mpm fetch`: fetch remotes of selected repos.
 */
import {repoLine, summaryText} from '../output/format.js';
import {isCloned} from '../repos/select.js';
import {skipped} from '../run/runner.js';

export default {
  name: 'fetch',
  helpGroup: 'Git commands:',
  summary: 'Fetch remotes of selected repos',
  description: 'Run `git fetch` in each selected repo. Repos that received ' +
    'new or changed refs are listed; use -v to see the refs.',
  selection: true,
  positionalRepos: true,
  progress: true,
  options: [
    {flags: '-p, --prune', description: 'remove deleted remote branches'},
    {flags: '--all-remotes', description: 'fetch all remotes, not just the ' +
      'default'},
    {flags: '--tags', description: 'fetch all tags'}
  ],

  async run({runRepos, options}) {
    const args = ['fetch'];
    if(options.prune) {
      args.push('--prune');
    }
    if(options.allRemotes) {
      args.push('--all');
    }
    if(options.tags) {
      args.push('--tags');
    }
    const results = await runRepos(async (repo, context) => {
      if(!await isCloned(repo)) {
        return skipped('missing');
      }
      const result = await context.run('git', args, {mutates: true});
      // fetch reports ref updates on stderr and is silent otherwise
      const output = result.stderr.trim();
      return {updated: output.length > 0, output};
    });
    return {results};
  },

  text: {
    repo(result, context) {
      const {c, verbose, dryRun} = context;
      if(result.status === 'ok') {
        if(dryRun) {
          return repoLine(result, context, '');
        }
        if(!result.data.updated && !verbose) {
          return;
        }
        const lines = [repoLine(result, context,
          result.data.updated ? 'updated' : c.dim('no changes'))];
        if(verbose && result.data.output) {
          lines.push(c.dim(result.data.output.replace(/^/gm, '  ')));
        }
        return lines.join('\n');
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
      const {ok} = report.summary;
      if(context.dryRun) {
        return summaryText(report, context, {parts: [`${ok} to fetch`]});
      }
      const updated = report.results.filter(r => r.data?.updated).length;
      return summaryText(report, context, {
        parts: [`${updated} updated`, `${ok - updated} unchanged`]
      });
    }
  }
};
