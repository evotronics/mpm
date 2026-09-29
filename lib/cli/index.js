/**
 * Command line interface: builds a commander program from the command
 * registry and runs commands.
 */
import {Command, CommanderError, InvalidArgumentError, Option}
  from 'commander';
import {createColors, shouldUseColor, summarize} from '../output/format.js';
import {createRenderer, JSON_SCHEMA_VERSION, OUTPUT_FORMATS}
  from '../output/renderers.js';
import {DEFAULT_SETTINGS, loadWorkspace} from '../workspace/load.js';
import {EXIT, MpmError} from '../errors.js';
import {commands} from '../commands/index.js';
import {findWorkspaceRoot} from '../workspace/find.js';
import fs from 'node:fs';
import path from 'node:path';
import {runRepos} from '../run/runner.js';
import {selectRepos} from '../repos/select.js';

const pkg = JSON.parse(fs.readFileSync(
  path.join(import.meta.dirname, '..', '..', 'package.json'), 'utf8'));

const GLOBAL_OPTIONS = [
  {
    short: '-C', long: '--workspace <dir>',
    description: 'workspace root (default: $MPM_WORKSPACE, or the nearest ' +
      'directory with mpm.yaml at or above the current directory)'
  },
  {
    short: '-n', long: '--dry-run',
    description: 'show changes (commands, file writes) without making them'
  },
  {
    short: '-j', long: '--jobs <n>',
    description: 'number of repos to process in parallel',
    parser: parsePositiveInt
  },
  {short: '-v', long: '--verbose', description: 'show more detail'},
  {short: '-q', long: '--quiet', description: 'only show problems'},
  {long: '--json', description: 'JSON output (same as --output json)'},
  {
    long: '--output <format>', description: 'output format',
    choices: OUTPUT_FORMATS
  },
  {long: '--color', description: 'force color output'},
  {long: '--no-color', description: 'disable color output'},
  {
    long: '--fail-fast',
    description: 'stop starting new repos after a failure'
  }
];

const GLOBAL_KEYS = ['workspace', 'dryRun', 'jobs', 'verbose', 'quiet', 'json',
  'output', 'color', 'failFast'];

/**
 * Run the CLI.
 *
 * @param {string[]} argv - Arguments, not including node and script.
 * @param {object} [options] - Options.
 * @param {object} [options.stdout] - Output stream.
 * @param {object} [options.stderr] - Error stream.
 * @param {string} [options.cwd] - Current directory.
 * @param {object} [options.env] - Environment.
 * @param {boolean} [options.handleSignals] - Handle SIGINT.
 *
 * @returns {Promise<number>} Exit code.
 */
export async function main(argv, {
  stdout = process.stdout, stderr = process.stderr, cwd = process.cwd(),
  env = process.env, handleSignals = false
} = {}) {
  const io = {stdout, stderr};
  const state = {exitCode: EXIT.OK};
  const program = createProgram({io, cwd, env, handleSignals, state});
  try {
    await program.parseAsync(argv, {from: 'user'});
  } catch(e) {
    if(e instanceof CommanderError) {
      // help and version exit with 0; parse errors are usage errors
      return e.exitCode === 0 ? EXIT.OK : EXIT.USAGE;
    }
    throw e;
  }
  return state.exitCode;
}

/**
 * Create the commander program.
 *
 * @param {object} options - Options.
 * @param {object} options.io - Streams.
 * @param {string} options.cwd - Current directory.
 * @param {object} options.env - Environment.
 * @param {boolean} options.handleSignals - Handle SIGINT.
 * @param {object} options.state - Receives `exitCode`.
 *
 * @returns {Command} Program.
 */
export function createProgram({io, cwd, env, handleSignals, state}) {
  const program = new Command('mpm')
    .description('Multiple Project Manager: manage, update, and search ' +
      'many git repos at once.')
    .version(pkg.version, '-V, --version')
    .enablePositionalOptions()
    .exitOverride()
    .configureOutput({
      writeOut: text => io.stdout.write(text),
      writeErr: text => io.stderr.write(text)
    })
    .configureHelp({showGlobalOptions: true, sortSubcommands: false})
    .showSuggestionAfterError()
    .addHelpText('after', `
Repo selection (most commands):
  -g, --group <group>   repos in a group (repeatable, comma separated)
  -t, --tag <expr>      repos by tag: a,b = either; a+b = both; !a = not a
  -r, --repo <glob>     repos by name or glob; "." = the current repo
  -x, --exclude <glob>  exclude repos
  -a, --all             include disabled repos and groups

Run "mpm <command> --help" for details.`);

  for(const option of GLOBAL_OPTIONS) {
    program.addOption(createOption(option));
  }

  for(const definition of commands) {
    addCommand(program, definition, {
      program, io, cwd, env, handleSignals, state
    });
  }
  return program;
}

/**
 * Add a command (and any subcommands) to a commander parent command.
 *
 * @param {Command} parent - Parent command.
 * @param {object} definition - Command definition.
 * @param {object} options - Shared CLI state.
 *
 * @returns {Command} The added command.
 */
function addCommand(parent, definition, options) {
  const {io} = options;
  const cmd = parent.command(definition.name)
    .summary(definition.summary)
    .description(definition.description ?? definition.summary)
    .exitOverride()
    .configureOutput({
      writeOut: text => io.stdout.write(text),
      writeErr: text => io.stderr.write(text)
    });
  for(const alias of definition.aliases ?? []) {
    cmd.alias(alias);
  }
  // accept global options after the command name too; they are listed
  // under "Global Options" in help
  const addGlobals = () => {
    for(const option of GLOBAL_OPTIONS) {
      if(cmd.options.some(o => o.long === option.long.split(' ')[0])) {
        continue;
      }
      cmd.addOption(createOption({
        ...option,
        short: definition.shortGlobals === false ? undefined : option.short
      }).hideHelp());
    }
  };

  if(definition.subcommands) {
    cmd.enablePositionalOptions();
    addGlobals();
    for(const subcommand of definition.subcommands) {
      addCommand(cmd, {
        ...subcommand,
        fullName: `${definition.fullName ?? definition.name} ` +
          subcommand.name
      }, options);
    }
    return cmd;
  }

  if(definition.passThrough) {
    cmd.passThroughOptions().allowUnknownOption();
  }
  for(const argument of definition.arguments ?? []) {
    cmd.argument(argument.name, argument.description);
  }
  if(definition.positionalRepos) {
    cmd.argument('[repos...]', 'repo names or globs (same as --repo)');
  }
  for(const option of definition.options ?? []) {
    cmd.addOption(createCommandOption(option));
  }
  if(definition.selection) {
    addSelectionOptions(cmd, definition);
  }
  addGlobals();

  cmd.action(async (...actionArgs) => {
    // commander passes declared arguments, then options, then the command
    const positional = actionArgs.slice(0, -2).flat()
      .filter(a => a !== undefined);
    options.state.exitCode = await executeCommand({
      ...options,
      definition: {...definition, name: definition.fullName ?? definition.name},
      cmd,
      positional
    });
  });
  return cmd;
}

async function executeCommand({
  definition, cmd, program, positional, io, cwd, env, handleSignals
}) {
  const options = cmd.opts();
  const globals = mergeGlobals(program, cmd);
  const format = globals.output ?? (globals.json ? 'json' : 'text');
  const colors = format === 'text' &&
    shouldUseColor({color: globals.color, stream: io.stdout, env});
  const c = createColors(colors);
  const dryRun = Boolean(globals.dryRun);
  const verbose = Boolean(globals.verbose);
  const quiet = Boolean(globals.quiet) && !verbose;

  let repoArgs = [];
  let args = positional;
  if(definition.positionalRepos) {
    const declared = (definition.arguments ?? []).length;
    repoArgs = positional.slice(declared);
    args = positional.slice(0, declared);
  }

  const renderer = createRenderer({
    format,
    command: definition,
    io,
    c,
    verbose,
    quiet,
    dryRun,
    // stdout must be a TTY too, or a progress line on stderr would draw
    // over a pager, e.g. `mpm grep foo | less`
    progress: Boolean(definition.progress) && format === 'text' &&
      Boolean(io.stderr.isTTY) && Boolean(io.stdout.isTTY) && !quiet &&
      !verbose && !options.interactive,
    options,
    args,
    cwd
  });

  const controller = new AbortController();
  let interrupts = 0;
  const onSigint = () => {
    if(++interrupts > 1) {
      process.exit(EXIT.INTERRUPTED);
    }
    renderer.notice('Interrupted; stopping. Press Ctrl-C again to force.');
    controller.abort();
  };
  if(handleSignals) {
    process.on('SIGINT', onSigint);
  }

  try {
    let workspace;
    let repos = [];
    if(definition.workspace !== false) {
      const root = await findWorkspaceRoot({
        workspace: globals.workspace, cwd, env
      });
      workspace = await loadWorkspace({root});
    }
    if(definition.selection) {
      const selection = await selectRepos(workspace, {
        groups: options.group,
        tags: options.tag,
        repos: [...options.repo ?? [], ...repoArgs],
        exclude: options.exclude,
        all: options.all,
        from: options.from,
        state: options.missing ? 'missing' :
          options.cloned ? 'cloned' : undefined
      }, {cwd});
      repos = selection.repos;
      selection.notices.forEach(n => renderer.notice(n));
    }
    const jobs = globals.jobs ?? workspace?.settings.jobs ??
      DEFAULT_SETTINGS.jobs;

    const output = await definition.run({
      workspace,
      repos,
      args,
      options,
      dryRun,
      verbose,
      quiet,
      jobs,
      io,
      env,
      cwd,
      colors,
      c,
      signal: controller.signal,
      notice: message => renderer.notice(message),
      runRepos(task, {interactive = false} = {}) {
        renderer.begin({total: repos.length});
        return runRepos({
          repos, task, jobs, dryRun, interactive,
          failFast: Boolean(globals.failFast),
          signal: controller.signal, env, renderer
        });
      }
    });

    const {results} = output;
    let exitCode = output.exitCode ??
      (results?.some(r => r.status === 'failed') ? EXIT.FAILED : EXIT.OK);
    if(controller.signal.aborted) {
      exitCode = EXIT.INTERRUPTED;
    }
    renderer.end({
      command: definition.name,
      dryRun,
      results,
      summary: results ? summarize(results) : undefined,
      data: output.data,
      context: output.context,
      exitCode
    });
    return exitCode;
  } catch(error) {
    return reportError({error, format, definition, io, c, verbose});
  } finally {
    if(handleSignals) {
      process.off('SIGINT', onSigint);
    }
  }
}

function reportError({error, format, definition, io, c, verbose}) {
  const known = error instanceof MpmError;
  const exitCode = known ? error.exitCode : EXIT.FAILED;
  if(format !== 'text') {
    const output = {
      schemaVersion: JSON_SCHEMA_VERSION,
      command: definition.name,
      ok: false,
      exitCode,
      error: {
        message: error.message,
        code: known ? error.code : 'INTERNAL_ERROR',
        ...(error.details?.length ? {details: error.details} : {})
      }
    };
    io.stdout.write(JSON.stringify(output, null, format === 'json' ? 2 : 0) +
      '\n');
    return exitCode;
  }
  io.stderr.write(`${c.red('mpm: error:')} ${error.message}\n`);
  for(const detail of error.details ?? []) {
    io.stderr.write(`  ${detail}\n`);
  }
  if(!known || verbose) {
    io.stderr.write(c.dim(`${error.stack}\n`));
  }
  return exitCode;
}

function mergeGlobals(program, cmd) {
  // the value given closest to the command wins, e.g.
  // `mpm -n npm --dry-run install`
  const globals = {};
  for(const key of GLOBAL_KEYS) {
    globals[key] = program.opts()[key];
    for(let current = cmd; current && current !== program;
      current = current.parent) {
      if(current.getOptionValueSource(key) === 'cli') {
        globals[key] = current.opts()[key];
        break;
      }
    }
  }
  return globals;
}

function addSelectionOptions(cmd, definition) {
  cmd.addOption(new Option('-g, --group <group>',
    'select repos in a group (repeatable, comma separated)')
    .argParser(collect));
  cmd.addOption(new Option('-t, --tag <expr>',
    'select repos by tag: a,b = either; a+b = both; !a = not a (repeatable)')
    .argParser(collect));
  if(!cmd.options.some(o => o.long === '--repo')) {
    cmd.addOption(new Option('-r, --repo <glob>',
      'select repos by name or glob; "." = the current repo (repeatable)')
      .argParser(collect));
  }
  cmd.addOption(new Option('-x, --exclude <glob>',
    'exclude repos by name or glob (repeatable)').argParser(collect));
  cmd.addOption(new Option(definition.shortAll === false ?
    '--all' : '-a, --all', 'include disabled repos and groups'));
  cmd.addOption(new Option('--from <repo>',
    'skip repos before this one (to resume a run)'));
  cmd.addOption(new Option('--missing', 'only repos that are not cloned')
    .conflicts('cloned'));
  cmd.addOption(new Option('--cloned', 'only repos that are cloned'));
}

function createOption({short, long, description, parser, choices}) {
  const option = new Option(short ? `${short}, ${long}` : long, description);
  if(parser) {
    option.argParser(parser);
  }
  if(choices) {
    option.choices(choices);
  }
  return option;
}

function createCommandOption({flags, description, choices, default: value}) {
  const option = new Option(flags, description);
  if(choices) {
    option.choices(choices);
  }
  if(value !== undefined) {
    option.default(value);
  }
  return option;
}

function collect(value, previous = []) {
  return [...previous, value];
}

function parsePositiveInt(value) {
  const number = Number(value);
  if(!Number.isInteger(number) || number < 1) {
    throw new InvalidArgumentError('Must be a positive integer.');
  }
  return number;
}
