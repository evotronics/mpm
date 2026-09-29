/**
 * `mpm status`: compact status of selected repos.
 */
import {formatTable, summarize, summaryText} from '../output/format.js';
import {EXIT} from '../errors.js';
import {getStatus} from '../git/status.js';
import {isCloned} from '../repos/select.js';
import {skipped} from '../run/runner.js';

export default {
  name: 'status',
  helpGroup: 'Git commands:',
  aliases: ['st'],
  summary: 'Show a compact status table of selected repos',
  description: 'Show branch, sync state, and local changes for selected ' +
    'repos. Repos that are clean, in sync, and on their default branch are ' +
    'hidden unless --show-clean is given. Ahead/behind counts use the last ' +
    'fetched remote state; use --fetch to fetch first.\n\n' +
    'SYNC: ↑N ahead, ↓N behind, "no upstream".\n' +
    'CHANGES: SN staged, MN modified, UN unmerged, ?N untracked, $N stashes.',
  selection: true,
  positionalRepos: true,
  progress: true,
  options: [
    {flags: '--show-clean', description: 'also show clean repos'},
    {flags: '-f, --fetch', description: 'fetch remotes first so ahead/behind ' +
      'counts are current'},
    {flags: '-l, --long', description: 'show full `git status` per repo'}
  ],

  async run({runRepos, options, colors, dryRun, notice}) {
    if(options.fetch && dryRun) {
      notice('Dry run: not fetching; ahead/behind counts are from the last ' +
        'fetch.');
    }
    const results = await runRepos(async (repo, context) => {
      if(!await isCloned(repo)) {
        return skipped('missing', {missing: true});
      }
      let fetchError;
      if(options.fetch) {
        try {
          await context.run('git', ['fetch', '--quiet'], {mutates: true});
        } catch(e) {
          // still show the local status
          fetchError = e.message;
        }
      }
      const status = await getStatus(context);
      if(fetchError) {
        status.fetchError = fetchError;
      }
      if(options.long) {
        const colorArgs = colors ? ['-c', 'color.status=always'] : [];
        const long = await context.run('git', [...colorArgs, 'status']);
        status.output = long.stdout;
      }
      return status;
    });
    for(const result of results) {
      if(result.status === 'ok') {
        result.data.interesting = isInteresting(result.data);
      }
    }
    const fetchFailed = results.some(r => r.data?.fetchError);
    return {results, ...(fetchFailed ? {exitCode: EXIT.FAILED} : {})};
  },

  text: {
    repo(result, {c, options}) {
      if(!options.long || result.status !== 'ok') {
        return;
      }
      if(!result.data.interesting && !options.showClean) {
        return;
      }
      return `${c.bold('=== ' + result.repo.name)}\n${result.data.output}`;
    },

    end(report, context) {
      const {c, options, quiet} = context;
      const {results} = report;
      const shown = results.filter(r => r.status !== 'ok' ||
        r.data.interesting || options.showClean);
      const lines = [];
      if(!options.long && shown.length > 0) {
        const rows = [['REPO', 'BRANCH', 'SYNC', 'CHANGES'].map(c.dim)];
        for(const result of shown) {
          rows.push(formatRow(result, c));
        }
        lines.push(formatTable(rows));
      }
      if(quiet && report.exitCode === 0) {
        return lines.join('\n');
      }
      if(options.long) {
        // failures and missing repos are not in the long output
        for(const result of results.filter(r => r.status !== 'ok')) {
          lines.push(formatRow(result, c).join('  '));
        }
      }
      const summary = summarize(results);
      const missing = results.filter(r => r.data?.missing).length;
      const changed = results.filter(r => r.data?.interesting).length;
      const clean = summary.ok - changed;
      const parts = [`${clean} clean`];
      if(changed > 0) {
        parts.push(c.yellow(`${changed} changed`));
      }
      if(missing > 0) {
        parts.push(c.yellow(`${missing} missing`));
      }
      if(summary.failed > 0) {
        parts.push(c.red(`${summary.failed} failed`));
      }
      const fetchFailures = results.filter(r => r.data?.fetchError);
      if(fetchFailures.length > 0) {
        parts.push(c.red(`${fetchFailures.length} fetch failed`));
      }
      const noun = summary.total === 1 ? 'repo' : 'repos';
      lines.push(`${summary.total} ${noun}: ${parts.join(', ')}`);
      if(fetchFailures.length > 0) {
        lines.push(c.red('Fetch failed:'));
        for(const result of fetchFailures) {
          lines.push(`  ${result.repo.name}: ${result.data.fetchError}`);
        }
      }
      if(summary.failed > 0) {
        lines.push(summaryText(report, context).split('\n').slice(1)
          .join('\n'));
      }
      return lines.join('\n');
    }
  },

  json: {
    repo(result) {
      if(result.status !== 'ok') {
        return result.data;
      }
      // omit raw output from structured data unless it was requested
      const {output, ...data} = result.data;
      return output === undefined ? data : {...data, output};
    }
  }
};

/**
 * Whether a repo status is worth showing by default.
 *
 * @param {object} status - Git status.
 *
 * @returns {boolean} True if the repo is not clean, in sync, and on its
 *   default branch.
 */
export function isInteresting(status) {
  return Boolean(status.fetchError) || status.dirty ||
    status.untracked > 0 || status.stash > 0 ||
    status.ahead > 0 || status.behind > 0 || status.detached ||
    !status.upstream ||
    Boolean(status.defaultBranch && status.branch !== status.defaultBranch);
}

function formatRow(result, c) {
  const {repo} = result;
  if(result.status === 'skipped') {
    return [repo.name, c.dim('—'), '', c.yellow(result.reason)];
  }
  if(result.status === 'failed') {
    return [repo.name, c.dim('—'), '', c.red(`error: ${result.reason}`)];
  }
  const s = result.data;
  let branch;
  if(s.detached) {
    branch = c.red(`(detached ${s.oid?.slice(0, 7) ?? ''})`);
  } else if(s.defaultBranch && s.branch !== s.defaultBranch) {
    branch = c.yellow(s.branch);
  } else {
    branch = s.branch ?? '';
  }
  const sync = [];
  if(!s.detached && !s.upstream) {
    sync.push(c.dim('no upstream'));
  }
  if(s.ahead > 0) {
    sync.push(c.green(`↑${s.ahead}`));
  }
  if(s.behind > 0) {
    sync.push(c.cyan(`↓${s.behind}`));
  }
  const changes = [];
  if(s.staged > 0) {
    changes.push(c.green(`S${s.staged}`));
  }
  if(s.modified > 0) {
    changes.push(c.red(`M${s.modified}`));
  }
  if(s.unmerged > 0) {
    changes.push(c.magenta(`U${s.unmerged}`));
  }
  if(s.untracked > 0) {
    changes.push(c.dim(`?${s.untracked}`));
  }
  if(s.stash > 0) {
    changes.push(c.blue(`$${s.stash}`));
  }
  if(s.fetchError) {
    changes.push(c.red('fetch failed'));
  }
  return [repo.name, branch, sync.join(' '), changes.join(' ')];
}
