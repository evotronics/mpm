/**
 * `mpm clean`: remove installed dependencies or all ignored files.
 */
import {formatBytes, repoLine, summaryText} from '../output/format.js';
import {directorySize, pathExists} from '../util/fs.js';
import fs from 'node:fs/promises';
import {isCloned} from '../repos/select.js';
import path from 'node:path';
import {skipped} from '../run/runner.js';

export default {
  name: 'clean',
  helpGroup: 'Other commands:',
  summary: 'Remove node_modules (or all git-ignored files) from repos',
  description: 'Remove the node_modules directory from each selected repo. ' +
    'With --ignored, run `git clean -fdX` instead, which removes every file ' +
    'ignored by git (node_modules, build output, coverage, ...). Use ' +
    '--dry-run first to see what would be removed.',
  selection: true,
  positionalRepos: true,
  progress: true,
  options: [
    {
      flags: '--ignored',
      description: 'remove all files ignored by git (git clean -fdX)'
    }
  ],

  async run({runRepos, options, dryRun}) {
    const results = await runRepos(async (repo, context) => {
      if(!await isCloned(repo)) {
        return skipped('missing');
      }
      if(options.ignored) {
        // git has its own dry run, which is read-only
        const result = await context.run('git', ['clean', '-dX',
          dryRun ? '--dry-run' : '--force']);
        const removed = [...result.stdout.matchAll(
          /^(?:Would remove|Removing) (.+)$/gm)].map(m => m[1]);
        if(removed.length === 0) {
          return skipped('nothing to clean');
        }
        return {removed};
      }
      const dir = path.join(repo.path, 'node_modules');
      if(!await pathExists(dir)) {
        return skipped('nothing to clean');
      }
      const stat = await fs.lstat(dir);
      const bytes = stat.isDirectory() ? await directorySize(dir) : 0;
      await context.action('remove node_modules',
        () => fs.rm(dir, {recursive: true, force: true}));
      return {removed: ['node_modules/'], bytes};
    });
    return {results};
  },

  text: {
    repo(result, context) {
      const {c, dryRun, verbose} = context;
      if(result.status === 'skipped' && !verbose) {
        return;
      }
      if(result.status !== 'ok') {
        return repoLine(result, context);
      }
      const {removed, bytes} = result.data;
      const size = bytes === undefined ? '' : ` (${formatBytes(bytes)})`;
      const what = removed.length === 1 ? removed[0] :
        `${removed.length} paths`;
      const lines = [repoLine(result, context,
        (dryRun ? c.cyan(`would remove ${what}`) : `removed ${what}`) +
        size)];
      if(removed.length > 1) {
        lines.push(...removed.map(p => c.dim(`  ${p}`)));
      }
      return lines.join('\n');
    },

    end(report, context) {
      if(context.quiet && report.exitCode === 0) {
        return;
      }
      const {ok, skipped: skippedCount} = report.summary;
      const nothing = report.results
        .filter(r => r.reason === 'nothing to clean').length;
      const bytes = report.results
        .reduce((sum, r) => sum + (r.data?.bytes ?? 0), 0);
      return summaryText(report, context, {
        parts: [
          `${ok} ${context.dryRun ? 'to clean' : 'cleaned'}` +
            (bytes ? ` (${formatBytes(bytes)})` : ''),
          `${nothing} already clean`
        ],
        skipped: skippedCount - nothing
      });
    }
  }
};
