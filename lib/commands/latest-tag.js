/**
 * `mpm latest-tag`: show the latest version tag of selected repos.
 */
import {formatTable} from '../output/format.js';
import {isCloned} from '../repos/select.js';
import {skipped} from '../run/runner.js';

export default {
  name: 'latest-tag',
  helpGroup: 'Git commands:',
  aliases: ['tags'],
  summary: 'Show the latest tag and commits since it',
  description: 'Show the highest version tag of each selected repo (by ' +
    'version sort) and how many commits HEAD has since that tag, which is ' +
    'handy for finding unreleased changes.',
  selection: true,
  positionalRepos: true,
  progress: true,
  options: [
    {flags: '--unreleased', description: 'only show repos with commits ' +
      'since their latest tag'}
  ],

  async run({runRepos}) {
    const results = await runRepos(async (repo, context) => {
      if(!await isCloned(repo)) {
        return skipped('missing');
      }
      const tags = await context.run('git',
        ['tag', '--list', '--sort=-version:refname']);
      const tag = tags.stdout.split('\n').find(Boolean) ?? null;
      if(!tag) {
        return {tag: null, commitsSince: null};
      }
      const count = await context.run('git',
        ['rev-list', '--count', `refs/tags/${tag}..HEAD`]);
      return {tag, commitsSince: Number(count.stdout.trim())};
    });
    return {results};
  },

  text: {
    end(report, {c, options}) {
      const rows = [['REPO', 'TAG', 'SINCE'].map(c.dim)];
      for(const result of report.results) {
        if(result.status === 'failed') {
          rows.push([result.repo.name, '', c.red(result.reason)]);
          continue;
        }
        if(result.status !== 'ok') {
          continue;
        }
        const {tag, commitsSince} = result.data;
        if(options.unreleased && !commitsSince) {
          continue;
        }
        rows.push([
          result.repo.name,
          tag ?? c.dim('—'),
          commitsSince ? c.yellow(`+${commitsSince}`) : ''
        ]);
      }
      return rows.length > 1 ? formatTable(rows) : c.dim('No repos to show.');
    }
  }
};
