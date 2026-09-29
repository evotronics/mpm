/**
 * `mpm pull`: update selected repos from their upstreams.
 */
import {actionLines, errorLines, statusMark, summaryText}
  from '../output/format.js';
import {getHead, getStatus} from '../git/status.js';
import {isCloned} from '../repos/select.js';
import {skipped} from '../run/runner.js';
import {UsageError} from '../errors.js';

export default {
  name: 'pull',
  helpGroup: 'Git commands:',
  summary: 'Pull selected repos (fast-forward only by default)',
  description: 'Run `git pull --ff-only` in each selected repo. Repos with ' +
    'uncommitted changes, a detached HEAD, or no upstream are skipped. ' +
    'Repos that have diverged from upstream fail and are listed at the end.',
  selection: true,
  positionalRepos: true,
  progress: true,
  options: [
    {flags: '--rebase', description: 'rebase local commits onto upstream'},
    {flags: '--merge', description: 'merge upstream (may create merges)'}
  ],

  async run({runRepos, options}) {
    if(options.rebase && options.merge) {
      throw new UsageError('Use only one of --rebase and --merge.');
    }
    let mode = ['--ff-only'];
    if(options.rebase) {
      mode = ['--rebase'];
    } else if(options.merge) {
      mode = ['--no-rebase', '--no-edit'];
    }

    const results = await runRepos(async (repo, context) => {
      if(!await isCloned(repo)) {
        return skipped('missing');
      }
      const status = await getStatus(context);
      if(status.dirty) {
        return skipped('uncommitted changes');
      }
      if(status.detached) {
        return skipped('detached HEAD');
      }
      if(!status.upstream) {
        return skipped('no upstream');
      }
      const before = await getHead(context);
      await context.run('git', ['pull', ...mode], {mutates: true});
      if(context.dryRun) {
        return {branch: status.branch, updated: false};
      }
      const after = await getHead(context);
      const data = {branch: status.branch, updated: before !== after};
      if(data.updated) {
        data.from = before;
        data.to = after;
        if(before) {
          const count = await context.run('git',
            ['rev-list', '--count', `${before}..${after}`]);
          data.commits = Number(count.stdout.trim());
        }
      }
      return data;
    });
    return {results};
  },

  text: {
    repo(result, context) {
      const {c, verbose, dryRun} = context;
      const lines = [];
      if(result.status === 'ok') {
        if(dryRun) {
          lines.push(`${statusMark(result, c)} ${result.repo.name}`);
        } else if(result.data.updated) {
          const {commits} = result.data;
          lines.push(`${statusMark(result, c)} ${result.repo.name}  ` +
            (commits === undefined ? 'updated' :
              `${commits} new commit${commits === 1 ? '' : 's'}`) +
            c.dim(` (${result.data.branch})`));
        } else if(verbose) {
          lines.push(`${statusMark(result, c)} ${result.repo.name}  ` +
            c.dim('up to date'));
        }
      } else if(result.status === 'skipped') {
        lines.push(`${statusMark(result, c)} ${result.repo.name}  ` +
          c.yellow(`skipped: ${result.reason}`));
      } else {
        lines.push(`${statusMark(result, c)} ${result.repo.name}  ` +
          c.red('failed'));
      }
      if(lines.length === 0) {
        return;
      }
      lines.push(...actionLines(result, context));
      lines.push(...errorLines(result, context));
      return lines.join('\n');
    },

    end(report, context) {
      if(context.quiet && report.exitCode === 0) {
        return;
      }
      const {ok} = report.summary;
      if(context.dryRun) {
        return summaryText(report, context, {parts: [`${ok} to pull`]});
      }
      const updated = report.results.filter(r => r.data?.updated).length;
      const parts = [`${ok - updated} up to date`];
      if(updated > 0) {
        parts.unshift(context.c.green(`${updated} updated`));
      }
      return summaryText(report, context, {parts});
    }
  }
};
