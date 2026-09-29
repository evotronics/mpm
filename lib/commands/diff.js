/**
 * `mpm diff`: show uncommitted changes in selected repos.
 */
import {isCloned} from '../repos/select.js';
import {skipped} from '../run/runner.js';

export default {
  name: 'diff',
  helpGroup: 'Git commands:',
  summary: 'Show uncommitted changes in selected repos',
  description: 'Run `git diff` in each selected repo and show the repos ' +
    'with changes. For other diff options use: ' +
    'mpm exec --read-only -- git diff ...',
  selection: true,
  positionalRepos: true,
  progress: true,
  options: [
    {flags: '--cached', description: 'show staged changes'},
    {flags: '--stat', description: 'only show a diffstat'},
    {flags: '--name-only', description: 'only show changed file names'}
  ],

  async run({runRepos, options, colors}) {
    const args = ['diff'];
    if(colors) {
      args.push('--color=always');
    }
    if(options.cached) {
      args.push('--cached');
    }
    if(options.stat) {
      args.push('--stat');
    } else if(options.nameOnly) {
      args.push('--name-only');
    } else {
      args.push('--patch', '--stat');
    }
    const results = await runRepos(async (repo, context) => {
      if(!await isCloned(repo)) {
        return skipped('missing');
      }
      const result = await context.run('git', args);
      return {changed: result.stdout.length > 0, output: result.stdout};
    });
    return {results};
  },

  text: {
    repo(result, {c, options}) {
      if(result.status === 'failed') {
        return c.red(`${result.repo.name}: ${result.reason}`);
      }
      if(result.status !== 'ok' || !result.data.changed) {
        return;
      }
      const output = result.data.output.replace(/\n$/, '');
      if(options.nameOnly) {
        return output.split('\n')
          .map(line => `${result.repo.relPath}/${line}`).join('\n');
      }
      return `${c.bold('=== ' + result.repo.name)}\n${output}`;
    },

    end(report, {c, quiet}) {
      if(quiet && report.exitCode === 0) {
        return;
      }
      const changed = report.results.filter(r => r.data?.changed).length;
      const {total, failed} = report.summary;
      return {
        err: `${changed} of ${total} repo${total === 1 ? '' : 's'} changed` +
          (failed > 0 ? c.red(`, ${failed} failed`) : '')
      };
    }
  }
};
