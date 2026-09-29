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
 */
import clone from './clone.js';
import exec from './exec.js';
import grep from './grep.js';
import init from './init.js';
import list from './list.js';
import pull from './pull.js';
import status from './status.js';

export const commands = [
  init,
  list,
  status,
  clone,
  pull,
  grep,
  exec
];
