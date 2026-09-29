/**
 * `mpm list`: show configured repos.
 */
import {formatTable} from '../output/format.js';
import {isCloned} from '../repos/select.js';

export default {
  name: 'list',
  aliases: ['ls'],
  summary: 'List configured repos',
  description: 'List selected repos with their group, checkout state, and ' +
    'tags. Disabled repos are only listed with --all.',
  selection: true,
  positionalRepos: true,
  options: [
    {flags: '-l, --long', description: 'also show URL and description'},
    {flags: '--names', description: 'print only repo names, one per line'},
    {flags: '--paths', description: 'print only checkout paths, one per line'}
  ],

  async run({repos}) {
    const cloned = await Promise.all(repos.map(isCloned));
    const data = repos.map((repo, i) => ({
      name: repo.name,
      group: repo.group,
      path: repo.relPath,
      url: repo.url,
      enabled: repo.enabled,
      cloned: cloned[i],
      tags: repo.tags,
      ...(repo.description ? {description: repo.description} : {})
    }));
    return {data, context: {repos}};
  },

  text: {
    end({data, context}, {c, options}) {
      if(options.names) {
        return data.map(r => r.name).join('\n');
      }
      if(options.paths) {
        return context.repos.map(r => r.path).join('\n');
      }
      if(data.length === 0) {
        return c.dim('No repos selected.');
      }
      const header = ['REPO', 'GROUP', 'STATE', 'TAGS'];
      if(options.long) {
        header.push('URL');
      }
      const rows = [header.map(h => c.dim(h))];
      for(const repo of data) {
        const state = [
          repo.cloned ? c.green('cloned') : c.yellow('missing'),
          ...(repo.enabled ? [] : [c.dim('disabled')])
        ].join(' ');
        const row = [
          repo.enabled ? repo.name : c.dim(repo.name),
          repo.group,
          state,
          repo.tags.join(',')
        ];
        if(options.long) {
          row.push(repo.url + (repo.description ?
            c.dim(`  # ${repo.description}`) : ''));
        }
        rows.push(row);
      }
      const clonedCount = data.filter(r => r.cloned).length;
      const missing = data.length - clonedCount;
      return formatTable(rows) + '\n' +
        `${data.length} repo${data.length === 1 ? '' : 's'}: ` +
        `${clonedCount} cloned` +
        (missing > 0 ? `, ${c.yellow(`${missing} missing`)}` : '');
    }
  }
};
