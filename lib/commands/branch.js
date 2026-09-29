/**
 * `mpm branch`: show local branches of selected repos.
 */
import {formatTable} from '../output/format.js';
import {isCloned} from '../repos/select.js';
import {skipped} from '../run/runner.js';

export default {
  name: 'branch',
  helpGroup: 'Git commands:',
  summary: 'Show local branches of selected repos',
  description: 'List the current and other local branches of each selected ' +
    'repo. Repos with only their default branch are hidden unless ' +
    '--show-clean is given.',
  selection: true,
  positionalRepos: true,
  progress: true,
  options: [
    {flags: '--show-clean', description: 'also show repos with only one ' +
      'branch'},
    {flags: '--remote', description: 'list remote tracking branches too'}
  ],

  async run({runRepos, options}) {
    const results = await runRepos(async (repo, context) => {
      if(!await isCloned(repo)) {
        return skipped('missing');
      }
      const args = ['branch', '--format=%(HEAD)%(refname:short)'];
      if(options.remote) {
        args.push('--all');
      }
      const result = await context.run('git', args);
      let current = null;
      const branches = [];
      for(const line of result.stdout.split('\n').filter(Boolean)) {
        const name = line.slice(1);
        if(line.startsWith('*')) {
          current = name;
        }
        branches.push(name);
      }
      return {current, branches};
    });
    return {results};
  },

  text: {
    end(report, {c, options, quiet}) {
      const rows = [['REPO', 'CURRENT', 'OTHER BRANCHES'].map(c.dim)];
      for(const result of report.results) {
        if(result.status === 'failed') {
          rows.push([result.repo.name, '', c.red(result.reason)]);
          continue;
        }
        if(result.status !== 'ok') {
          continue;
        }
        const {current, branches} = result.data;
        const others = branches.filter(b => b !== current);
        if(others.length === 0 && !options.showClean) {
          continue;
        }
        rows.push([result.repo.name, current ?? c.red('(detached)'),
          others.join(' ')]);
      }
      const lines = rows.length > 1 ? [formatTable(rows)] : [];
      if(!quiet) {
        const total = report.summary.total;
        lines.push(`${total} repo${total === 1 ? '' : 's'}, ` +
          `${rows.length - 1} shown`);
      }
      return lines.join('\n');
    }
  }
};
