# mpm ChangeLog

## 0.1.0 - TBD

### Changed
- **BREAKING**: Rewrite in JavaScript (Node.js >= 22) as a single installable
  `mpm` command (also installed as `multiple-project-manager`). The per-group
  `mpm-GROUP` wrapper scripts are no longer needed: use `mpm -g GROUP ...`.
- **BREAKING**: New YAML config. A workspace is a directory with `mpm.yaml`
  (settings) and `mpm.d/GROUP.yaml` files (one per group). Config files are
  validated against JSON Schemas in `schemas/`. The workspace is found from
  any directory inside it, so `./mpm` / `../mpm` path juggling is gone.
  Existing `mpm-GROUP.conf` configs must be converted by hand.
- **BREAKING**: Command line uses `mpm [global options] <command> [options]
  [args...]`. `-m MOD` is now `-r/--repo GLOB` (or positional repo
  arguments) and `-s MOD` is now `--from REPO`.
- `pull` uses `git pull --ff-only` by default. It skips repos with
  uncommitted changes, a detached HEAD, or no upstream, and reports diverged
  repos as failures.
- `status` shows a compact table of the repos needing attention, instead of
  full `git status` output for every repo (`--long` restores that).
- Commands keep going after a repo fails, then print a summary of failures
  and exit non-zero. `--fail-fast` stops early.

### Added
- Group `source` shorthand (`github:owner`) that expands to ssh or https
  URLs according to the `protocol` setting. Repos can be a name, an
  `owner/name`, or a full URL.
- Enable or disable repos and groups with `enabled: false`, replacing the
  `X_`/`XXX_` variable prefixes and commented out lines.
- Repo tags, and selection by group (`-g`), tag expression (`-t a,b`,
  `-t a+b`, `-t '!a'`), name or glob (`-r`), exclusion (`-x`), checkout
  state (`--missing`, `--cloned`), and `-a/--all` for disabled repos.
- Parallel execution with `-j/--jobs` (default from config), output shown in
  repo order, and a progress line on terminals.
- `--dry-run` for every command that changes things, `--json` and
  `--output ndjson` for automation, `--verbose`, `--quiet`, and `--color`.
- `init` command to create a workspace.
- `list` command.
- `exec` command to run any command in each repo (`--shell`, `--prefix`,
  `--interactive`, `--read-only`), replacing one-off commands such as
  `ls-files`, `shortlog-sen`, and `tig`.
- `grep` prints paths relative to the current directory so editors can open
  them, and exits like grep (0 match, 1 no match, 2 error).
- `fetch` (`--prune`, `--all-remotes`, `--tags`) lists the repos that
  received updates.
- `push` only pushes repos that are ahead of their upstream.
- `diff` (`--cached`, `--stat`, `--name-only`) only shows changed repos.
  Replaces `diff` and `diffc`.
- `branch` shows a table of repos with branches other than the current one.
- `latest-tag` (alias `tags`) sorts tags by version, not text, and shows the
  commits since the latest tag (`--unreleased` to filter).
- `gc` reports `.git` sizes before and after, and the total saved.
- `prune` (`--remote`) uses `git remote prune --dry-run` for dry runs.
  Replaces `prune` and `prune-n`.
- `npm` command group: `install`, `ci`, `update`, `rebuild`, `ls`, and
  `outdated` (a combined table of outdated packages across repos). Repos
  without a `package.json` are skipped.
- `clean` removes `node_modules` with sizes shown, or with `--ignored` runs
  `git clean -fdX` (previewed with `git clean --dry-run` under `-n`).
- Config editing commands. Files are edited in place, keeping comments and
  entry order. The resulting config is validated before anything is written,
  and `--dry-run` shows a unified diff.
  - `repo add|rm|enable|disable|tag|show`. `repo add` inserts entries in
    sorted order, stores URLs that match the group source as short names, and
    can `--clone`. `repo rm --delete` refuses to delete checkouts with
    uncommitted, untracked, stashed, or unpushed work unless `--force` is
    given.
  - `group list|add|rm|enable|disable|set|tag`.
  - `config get|set|unset|path|validate|edit`. Bare setting names such as
    `jobs` are shorthand for `settings.jobs`. `edit` opens `$VISUAL` or
    `$EDITOR`, then validates.
- `doctor` checks the workspace for directories that are not in the config
  (with `repo add` suggestions), enabled repos that are not cloned, disabled
  repos that are still checked out, paths that are not git checkouts, and
  `origin` URLs that differ from the config.
- Command aliases in `mpm.yaml` (`aliases: {up: pull --rebase}`), given as a
  string or an argument array. Options and arguments around an alias are
  kept. Built-in commands take precedence, and alias loops are reported.
- Help lists commands in groups.
- User config (`~/.config/mpm/config.yaml`, following `XDG_CONFIG_HOME`, or
  `MPM_USER_CONFIG`) for personal `protocol` and `jobs` settings and aliases
  across workspaces. `MPM_PROTOCOL` overrides the protocol. Precedence is
  `MPM_PROTOCOL`, workspace `mpm.yaml`, user config, then defaults.
  `config get --show-origin` shows where values come from, and
  `config set|unset|edit --user` edit the user config.
- Shell completion for bash, zsh, and fish (`mpm completion <shell>`),
  covering commands, options, repo names, group ids, tags (including inside
  tag expressions), config keys, and aliases.

### Fixed
- Arguments with spaces or shell metacharacters (for example
  `mpm grep 'foo bar'`) are passed through intact.
- Errors return a non-zero exit code.
- Classic version issues that no longer apply: `clean` and `npm-rebuild`
  never ran, the no-rebuild list variable name did not match, and help showed
  an undefined module list.

### Removed
- **BREAKING**: `bower` and `bower-ls` commands.
- **BREAKING**: The `npm` command's "install if `node_modules` is missing,
  otherwise update" behavior. Use `mpm npm install` or `mpm npm update`.
  `npm-ls`, `npm-outdated`, and `npm-rebuild` are now `mpm npm ls`,
  `mpm npm outdated`, and `mpm npm rebuild`.

## Classic bash version

The original `mpm` (2014) was a bash script, `bin/mpm`, used with per-group
wrapper scripts and `mpm-GROUP.conf` shell configs. It ran git and npm commands
over lists of repos cloned into one directory. It was replaced by this rewrite;
the script and its configuration examples (`examples/`) can be found in git
history (commit `9afad0b`). Its commands were `clone`, `pull`, `push`,
`status`, `diff`, `diffc`, `branch`, `grep`, `gc`, `prune`, `prune-n`,
`ls-files`, `shortlog-sen`, `tig`, `clean`, `npm`, `npm-ls`, `npm-outdated`,
`npm-rebuild`, `bower`, `bower-ls`, and `latest-tag`.
