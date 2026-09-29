/**
 * `mpm npm <subcommand>`: npm helpers for repos with a package.json.
 */
import {formatTable, repoLine, summaryText}
  from '../output/format.js';
import {isCloned} from '../repos/select.js';
import path from 'node:path';
import {pathExists} from '../util/fs.js';
import {skipped} from '../run/runner.js';

const QUIET_SKIPS = ['missing', 'no package.json'];

async function precheck(repo) {
  if(!await isCloned(repo)) {
    return skipped('missing');
  }
  if(!await pathExists(path.join(repo.path, 'package.json'))) {
    return skipped('no package.json');
  }
  return null;
}

/**
 * Create a subcommand that runs npm in each repo and reports success or
 * failure.
 *
 * @param {object} options - Options.
 * @param {string} options.name - Subcommand name.
 * @param {string} options.summary - Help summary.
 * @param {string[]} options.args - Arguments for npm.
 * @param {boolean} options.mutates - True if the command changes files.
 * @param {string} options.done - Past tense label, e.g. "installed".
 *
 * @returns {object} Command definition.
 */
function npmCommand({name, summary, args, mutates, done}) {
  return {
    name,
    summary,
    description: `${summary}. Repos without a package.json are skipped.`,
    selection: true,
    positionalRepos: true,
    progress: true,

    async run({runRepos}) {
      const results = await runRepos(async (repo, context) => {
        const skip = await precheck(repo);
        if(skip) {
          return skip;
        }
        const result = await context.run('npm', args, {mutates});
        return {output: result.output};
      });
      return {results};
    },

    text: {
      repo(result, context) {
        const {c, verbose, dryRun} = context;
        if(result.status === 'skipped' &&
          QUIET_SKIPS.includes(result.reason) && !verbose) {
          return;
        }
        if(result.status !== 'ok') {
          return repoLine(result, context);
        }
        const lines = [repoLine(result, context, dryRun ? '' : done)];
        const output = result.data.output.trim();
        if(output && verbose) {
          lines.push(c.dim(output.replace(/^/gm, '  ')));
        }
        return lines.join('\n');
      },

      end(report, context) {
        if(context.quiet && report.exitCode === 0) {
          return;
        }
        const {ok, skipped: skippedCount} = report.summary;
        const quietSkips = report.results
          .filter(r => QUIET_SKIPS.includes(r.reason)).length;
        return summaryText(report, context, {
          parts: [`${ok} ${context.dryRun ? `to ${name}` : done}`],
          skipped: skippedCount - quietSkips
        });
      }
    }
  };
}

const outdated = {
  name: 'outdated',
  summary: 'Show outdated dependencies',
  description: 'Run `npm outdated` in each selected repo with a ' +
    'package.json and show a combined table. WANTED is the newest version ' +
    'allowed by package.json and LATEST the newest published.',
  selection: true,
  positionalRepos: true,
  progress: true,

  async run({runRepos}) {
    const results = await runRepos(async (repo, context) => {
      const skip = await precheck(repo);
      if(skip) {
        return skip;
      }
      // exits with 1 when anything is outdated
      const result = await context.run('npm', ['outdated', '--json'],
        {allowExitCodes: [0, 1]});
      return {packages: parseOutdated(result.stdout)};
    });
    return {results};
  },

  text: {
    end(report, context) {
      const {c, quiet} = context;
      const rows = [['REPO', 'PACKAGE', 'CURRENT', 'WANTED', 'LATEST']
        .map(c.dim)];
      for(const result of report.results) {
        if(result.status !== 'ok') {
          continue;
        }
        for(const p of result.data.packages) {
          rows.push([
            result.repo.name,
            p.name,
            p.current ?? c.dim('—'),
            p.wanted === p.current ? p.wanted : c.yellow(p.wanted),
            p.latest === p.wanted ? p.latest : c.red(p.latest)
          ]);
        }
      }
      const lines = rows.length > 1 ? [formatTable(rows)] : [];
      for(const result of report.results) {
        if(result.status === 'failed') {
          lines.push(repoLine(result, context));
        }
      }
      if(!quiet || report.exitCode !== 0) {
        const withOutdated = report.results
          .filter(r => r.data?.packages?.length > 0).length;
        lines.push(`${rows.length - 1} outdated packages in ${withOutdated} ` +
          `repo${withOutdated === 1 ? '' : 's'}`);
      }
      return lines.join('\n');
    }
  }
};

/**
 * Parse `npm outdated --json` output.
 *
 * @param {string} text - JSON output.
 *
 * @returns {Array<object>} Packages: `{name, current, wanted, latest}`.
 */
export function parseOutdated(text) {
  if(!text.trim()) {
    return [];
  }
  const data = JSON.parse(text);
  const packages = [];
  for(const [name, value] of Object.entries(data)) {
    // npm workspaces report an array per package
    for(const info of Array.isArray(value) ? value : [value]) {
      packages.push({
        name,
        current: info.current ?? null,
        wanted: info.wanted,
        latest: info.latest
      });
    }
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

const ls = {
  ...npmCommand({
    name: 'ls',
    summary: 'Check installed dependency trees with `npm ls`',
    args: ['ls'],
    mutates: false,
    done: 'ok'
  }),
  description: 'Run `npm ls` in each selected repo with a package.json. ' +
    'Repos with missing, invalid, or extraneous dependencies fail and their ' +
    'problems are shown; use -v to see every tree.'
};

export default {
  name: 'npm',
  helpGroup: 'Other commands:',
  summary: 'Run npm tasks in selected repos',
  description: 'Run npm tasks in each selected repo that has a ' +
    'package.json. For other npm commands use: mpm exec -- npm ...',
  subcommands: [
    npmCommand({
      name: 'install', summary: 'Run `npm install`', args: ['install'],
      mutates: true, done: 'installed'
    }),
    npmCommand({
      name: 'ci', summary: 'Run `npm ci` (clean install from lockfile)',
      args: ['ci'], mutates: true, done: 'installed'
    }),
    npmCommand({
      name: 'update', summary: 'Run `npm update`', args: ['update'],
      mutates: true, done: 'updated'
    }),
    npmCommand({
      name: 'rebuild', summary: 'Run `npm rebuild`', args: ['rebuild'],
      mutates: true, done: 'rebuilt'
    }),
    ls,
    outdated
  ]
};

