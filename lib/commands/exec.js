/**
 * `mpm exec`: run a command in each selected repo.
 */
import {actionLines, statusMark} from '../output/format.js';
import {isCloned} from '../repos/select.js';
import {skipped} from '../run/runner.js';
import {UsageError} from '../errors.js';

export default {
  name: 'exec',
  helpGroup: 'Other commands:',
  summary: 'Run a command in each selected repo',
  description: 'Run a command in each selected, cloned repo. mpm options ' +
    'must come first; everything from the command name on is passed ' +
    'through unchanged. The command is treated as changing state, so it is ' +
    'not run with --dry-run unless --read-only is given.\n\n' +
    'Environment: MPM_WORKSPACE, MPM_REPO, MPM_GROUP, MPM_REPO_PATH, ' +
    'MPM_REPO_URL.\n\n' +
    'Examples:\n' +
    '  mpm exec -- npm outdated\n' +
    '  mpm exec -g core --shell -- \'git log -1 --format=%ci\'\n' +
    '  mpm exec --interactive -- tig',
  selection: true,
  passThrough: true,
  progress: true,
  arguments: [{name: '<command...>', description: 'command and arguments'}],
  options: [
    {flags: '--shell', description: 'run the command string with `sh -c`'},
    {
      flags: '-i, --interactive',
      description: 'run one repo at a time with the terminal attached'
    },
    {
      flags: '--prefix',
      description: 'prefix output lines with the repo name instead of ' +
        'printing a header'
    },
    {
      flags: '--read-only',
      description: 'command does not change state; run it even with ' +
        '--dry-run'
    }
  ],

  async run({runRepos, args, options, workspace, io, colors: useColors, c}) {
    if(args.length === 0) {
      throw new UsageError('No command given.');
    }
    const [cmd, ...cmdArgs] = options.shell ?
      ['sh', '-c', args.join(' ')] : args;
    const interactive = Boolean(options.interactive);

    const results = await runRepos(async (repo, context) => {
      if(!await isCloned(repo)) {
        return skipped('missing');
      }
      if(interactive) {
        io.stdout.write(`${c.bold('=== ' + repo.name)}\n`);
      }
      const result = await context.run(cmd, cmdArgs, {
        mutates: !options.readOnly,
        env: {
          MPM_WORKSPACE: workspace.root,
          MPM_REPO: repo.name,
          MPM_GROUP: repo.group,
          MPM_REPO_PATH: repo.path,
          MPM_REPO_URL: repo.url,
          ...(useColors ? {FORCE_COLOR: '1'} : {})
        }
      });
      return {output: result.output, exitCode: result.code};
    }, {interactive});
    return {results};
  },

  text: {
    repo(result, context) {
      const {c, verbose, options} = context;
      const output = result.data?.output ?? result.error?.result?.output ?? '';
      const actions = actionLines(result, context);
      if(result.status === 'skipped') {
        return verbose ?
          `${statusMark(result, c)} ${result.repo.name}  ` +
          c.dim(`skipped: ${result.reason}`) : undefined;
      }
      if(options.interactive) {
        return result.status === 'failed' ?
          c.red(`${result.repo.name}: ${result.reason}`) : undefined;
      }
      if(!output && actions.length === 0 && result.status === 'ok' &&
        !verbose) {
        return;
      }
      if(options.prefix) {
        const lines = output.replace(/\n$/, '').split('\n')
          .filter((line, i, all) => line || all.length > 1)
          .map(line => `${c.bold(result.repo.name)}: ${line}`);
        if(result.status === 'failed') {
          lines.push(`${c.bold(result.repo.name)}: ` +
            c.red(result.reason));
        }
        return [...actions, ...lines].join('\n');
      }
      const lines = [c.bold(`=== ${result.repo.name}`), ...actions];
      if(output) {
        lines.push(output.replace(/\n$/, ''));
      }
      if(result.status === 'failed') {
        lines.push(c.red(result.reason));
      }
      return lines.join('\n');
    }
  },

  json: {
    repo(result) {
      if(result.status === 'failed') {
        const output = result.error?.result?.output;
        return output === undefined ? undefined :
          {output, exitCode: result.error.result.code};
      }
      return result.data;
    }
  }
};
