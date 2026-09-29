/**
 * `mpm gc`: run `git gc` and report space saved.
 */
import {formatBytes, repoLine, summaryText} from '../output/format.js';
import {directorySize} from '../util/fs.js';
import {isCloned} from '../repos/select.js';
import path from 'node:path';
import {skipped} from '../run/runner.js';

export default {
  name: 'gc',
  helpGroup: 'Git commands:',
  summary: 'Run `git gc` in selected repos and report space saved',
  selection: true,
  positionalRepos: true,
  progress: true,
  options: [
    {flags: '--aggressive', description: 'pass --aggressive to git gc'}
  ],

  async run({runRepos, options}) {
    const results = await runRepos(async (repo, context) => {
      if(!await isCloned(repo)) {
        return skipped('missing');
      }
      const gitDir = path.join(repo.path, '.git');
      const before = await directorySize(gitDir);
      await context.run('git',
        ['gc', '--quiet', ...options.aggressive ? ['--aggressive'] : []],
        {mutates: true});
      const after = context.dryRun ? before : await directorySize(gitDir);
      return {before, after};
    });
    return {results};
  },

  text: {
    repo(result, context) {
      if(result.status === 'ok') {
        const {before, after} = result.data;
        return repoLine(result, context, context.dryRun ?
          formatBytes(before) :
          `${formatBytes(before)} → ${formatBytes(after)}`);
      }
      if(result.reason === 'missing' && !context.verbose) {
        return;
      }
      return repoLine(result, context);
    },

    end(report, context) {
      let before = 0;
      let after = 0;
      for(const result of report.results) {
        if(result.status === 'ok') {
          before += result.data.before;
          after += result.data.after;
        }
      }
      const {ok} = report.summary;
      return summaryText(report, context, {
        parts: [context.dryRun ? `${ok} to gc (${formatBytes(before)})` :
          `${ok} collected: ${formatBytes(before)} → ${formatBytes(after)}` +
          ` (saved ${formatBytes(before - after)})`]
      });
    }
  }
};
