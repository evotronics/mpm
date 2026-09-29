/**
 * Command registry. The CLI (and help) is generated from these definitions.
 *
 * A command definition:
 *
 * - `name`, `aliases`, `summary`, `description`: naming and help.
 * - `workspace`: false if the command does not need a loaded workspace.
 * - `selection`: add repo selection options.
 * - `positionalRepos`: accept `[repos...]` as extra `--repo` values.
 * - `passThrough`: everything from the first unknown argument on is passed
 *   through to `args` unparsed.
 * - `shortGlobals`: false to only accept long forms of global options after
 *   the command name (to avoid clashing with pass through arguments).
 * - `shortAll`: false to only accept `--all` (not `-a`).
 * - `arguments`, `options`: extra commander arguments and options.
 * - `progress`: show a progress line on TTYs.
 * - `run(context)`: returns `{results?, data?, exitCode?, context?}`.
 * - `text.repo(result, format)`, `text.end(report, format)`: text output.
 * - `json.repo(result)`: per-repo JSON data.
 * - `helpGroup`: heading the command is listed under in help.
 * - `subcommands`: definitions of nested commands (`mpm npm install`); the
 *   parent then only groups them.
 */
import branch from './branch.js';
import clean from './clean.js';
import clone from './clone.js';
import config from './config.js';
import diff from './diff.js';
import exec from './exec.js';
import fetch from './fetch.js';
import gc from './gc.js';
import grep from './grep.js';
import group from './group.js';
import init from './init.js';
import latestTag from './latest-tag.js';
import list from './list.js';
import npm from './npm.js';
import prune from './prune.js';
import pull from './pull.js';
import push from './push.js';
import repo from './repo.js';
import status from './status.js';

export const commands = [
  init,
  list,
  repo,
  group,
  config,
  status,
  clone,
  fetch,
  pull,
  push,
  diff,
  branch,
  latestTag,
  grep,
  exec,
  npm,
  clean,
  gc,
  prune
];
