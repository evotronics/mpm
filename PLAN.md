# mpm — Multiple Project Manager: Rewrite Plan

Status: **v0.3**. Decisions from Q&A rounds 1–4 are folded in, and
milestones 1–3 are implemented (see §8). Decisions are marked
✅ decided, 🟡 proposed default, or ❓ open question.

## 1. Goals

- Manage many git repos, grouped by org or project, checked out under one
  workspace directory.
- Run one command across all of them (or a selected subset), in parallel where
  that is safe: update, check status, **grep everything**, run arbitrary
  commands.
- Keep a structured, editable config that the tool itself can change: add or
  remove repos, enable or disable them, tag them. Every mutation supports a
  dry run.
- Human-friendly CLI first. The architecture should also support JSON output
  for automation and a TUI later.
- BSD licensed and published to npm (scope TBD).

### Non-goals (for now)

- Replacing git or npm workspaces, or doing dependency-aware builds.
- Hosting-provider APIs (GitHub or GitLab) in the core. Planned only as an
  optional later feature: `discover`.

## 2. Lessons from the legacy sh version

| Legacy behavior | Problem | New design |
|---|---|---|
| `./mpm`, `../mpm-ORG` wrappers that source `.conf` shell files | Must run from a specific relative path; per-org scripts are boilerplate | One installed `mpm` binary; finds the workspace by walking up from cwd (like git) |
| "Org" = `GITHUB_BASE` + lists | one group reused another group's base, so an org is really a *group* | **Groups** are logical; each repo resolves its own URL |
| `X_…` / `XXX_…` var prefixes, commented lines, commented `source` lines | Ad hoc enable/disable | `enabled: false` on a repo or group; `mpm repo disable` |
| `CLONE_MODS` / `DEFAULT_MODS` / `EXTRA_MODS` / `NO_BUILD_MODS` | Overlapping lists; aggregator copy-paste bug sets them all to the first group's list | One repo list per group, plus `enabled` and `tags` |
| `NO_BUILD_MODS` vs `NO_REBUILD_MODS`; `-x package.json` | npm-rebuild skip list and npm-rebuild itself never work | Tests for every command |
| `clean` never dispatched; help says "make clean"; `$ALLMODS` undefined | Dead or incorrect features | Commands generated from one registry, so help can't drift |
| `$@` / `$GREPARGS` unquoted | `mpm grep "foo bar"` and regex metacharacters break | argv arrays passed straight to `spawn`; no shell |
| `exit` (status 0) on failure; first failure aborts everything | Can't script it; one bad repo blocks the rest | Keep going by default, print a failure summary, return a nonzero exit code; `--fail-fast` option |
| Sequential loop | Slow for 300+ repos | `p-queue` with `-j/--jobs N` |
| Sources a nonexistent group `.conf` | Silent config errors | Schema validation with clear errors |
| Flat dir, no collision detection | Two groups with the same repo name would clash | Validate unique paths |

## 3. Technology

- ✅ **JavaScript (Node.js, ESM)**, in line with Digital Bazaar conventions.
- ✅ Node **>= 22** (current LTS lines as of 2026-09 are 22 and 24).
- ✅ CLI parser: **commander**, wired up from an internal command registry.
- ✅ Plain ESM JavaScript with JSDoc, no build step (`tsc --checkJs` possible
  later).
- ✅ Binaries: `mpm`, plus a longer alias `multiple-project-manager`. npm scope
  TBD.
- 🟡 Libraries:
  - `yaml` (eemeli): its **Document API preserves comments and formatting**,
    which we need so that `mpm repo add` doesn't wipe hand-written comments.
  - `ajv`: JSON Schema validation. Publish the schema too, so editors get
    completion via `# yaml-language-server: $schema=…`.
  - `p-queue` / `p-map`: concurrency.
  - `execa` (or `nano-spawn` / plain `child_process`): process spawning.
  - `picocolors`: color. Later, `ink` or `listr2` for the TUI or progress
    display.
- ✅ Tests: **vitest**.
- ✅ Tooling: `@digitalbazaar/eslint-config` (ESLint flat config, with
  `sort-imports` off), GitHub Actions CI, and a Keep a Changelog style
  `CHANGELOG.md` (including notes on the classic version).
- ✅ License: BSD-3-Clause, copyright David I. Lehn (`LICENSE.md`).

## 4. Core concepts

- **Workspace**: the big directory holding all the checkouts. It is marked by
  `mpm.yaml` at its root. Found by `--workspace/-C`, then `$MPM_WORKSPACE`,
  then walking up from cwd. So `mpm status` works from the workspace root *or
  from inside any repo* in it.
  - ✅ Workspaces are independent; there is no global registry. Use multiple
    workspaces as needed.
  - ✅ Layout is **flat** (`<ws>/<repo-name>`). The schema reserves
    `settings.layout` (`flat` now; `group` / `host` possible later), and all
    path computation goes through one function so another layout is easy to
    add.
- **Group**: a named set of repos with shared defaults (`source`, `tags`,
  `enabled`). This replaces "org".
- **Repo**: an entry in a group. Its identity is its **name**, which is also
  its default directory. Names must be unique across the workspace, or the
  repo sets an explicit `path`.
- **Tag**: a free-form label on a repo or group (inherited from the group).
- ✅ **Disabled** (`enabled: false` on a repo or group) means excluded from
  *every* command, including grep and status of existing checkouts, unless
  named explicitly or `--all` is passed.
- **Selection**: which repos a command acts on (see §6).
- **User config** (🟡 `~/.config/mpm/config.yaml`, XDG): personal preferences
  such as clone protocol (ssh/https), default jobs, color, and a default
  workspace.

## 5. Config format

✅ The workspace root holds `mpm.yaml` (settings and aliases) plus
`mpm.d/*.yaml`, one file per group, loaded by glob. The file name is the group
id. Groups load in file-name order; repos appear in file order.

```
~/projects/dev/
  mpm.yaml
  mpm.d/
    core.yaml
    apps.yaml
    extras.yaml    # enabled: false
  widget/
  widget-account/
  ...
```

```yaml
# mpm.yaml
# yaml-language-server: $schema=https://…/mpm.schema.json
version: 1
settings:
  jobs: 8                 # default parallelism
  protocol: ssh           # how `github:` sources expand (ssh | https)
  layout: flat            # reserved; only `flat` for now
aliases:                  # (later milestone)
  outdated: exec -- npm outdated
```

```yaml
# mpm.d/core.yaml
title: Example Org
source: github:example-org     # or git@github.com:example-org / https://…
enabled: true
tags: [core]
repos:
  - widget                     # short form: resolved against `source`
  - widget-account
  - parser.js
  - name: widget-old           # long form
    enabled: false
    tags: [archived]
  - other-org/other-repo       # owner/name: same host, other owner
  - url: https://gitlab.com/x/y.git   # full URL override
    name: y-gitlab             # name (and so the dir); defaults to the URL basename
```

✅ Repos are a list. A string is the short form; an object is used when more
fields are needed. `mpm repo add` inserts entries alphabetically and keeps
comments.

Repo reference resolution, in order:

1. Full URL (`https://`, `ssh://`, `git@host:`, `file://`, or an absolute
   path): used as is.
2. `owner/name`: same host and protocol as the group source, different owner.
3. `name`: `source` + `/` + `name` + `.git`.

`github:owner` (also `gitlab:`, `codeberg:`) is a protocol-neutral shorthand.
It expands to ssh or https according to `settings.protocol`, so the *same
shared group file* works for people with different auth setups.

Repo names (and so directories) must be unique across the workspace.
Validation reports duplicates.

## 6. CLI design

```
mpm [global options] <command> [subcommand] [options] [args...]
```

### Global options

| Option | Meaning |
|---|---|
| `-C, --workspace <dir>` | Workspace root (else `$MPM_WORKSPACE`, else walk up) |
| `-n, --dry-run` | Show mutating actions (commands and config diffs) without running them. Read-only commands still run. |
| `-j, --jobs <n>` | Concurrency (default from config; `1` = sequential) |
| `-v, --verbose` / `-q, --quiet` | Verbosity |
| `--output <text\|json\|ndjson>` (`--json` alias) | Output format |
| `--color / --no-color` | Honors `NO_COLOR` and TTY detection |
| `--fail-fast` | Stop scheduling new work after the first failure |

### Selection options (on every multi-repo command)

| Option | Meaning |
|---|---|
| `-g, --group <name>` | Repeatable. Replaces `mpm-ORG`. |
| `-t, --tag <tag>` | Repeatable. `-t a -t b` = OR; `-t a+b` = AND; `-t '!archived'` = NOT |
| `-r, --repo <glob>` | Repeatable. Replaces `-m`. Positional repo args are also accepted where unambiguous. |
| `-x, --exclude <glob>` | |
| `--from <repo>` | Resume from a repo in config order. Replaces `-s`. |
| `--all` | Include disabled repos and groups |
| `--missing` / `--cloned` | State filters (`--dirty` later) |

The default selection is all *enabled* repos in *enabled* groups. Naming a
disabled group or repo explicitly (`-g ch`) selects it, with a notice.

### Commands (v1)

Repo operations (parallel unless noted):

- `clone`: clone missing enabled repos. Replaces `mpm-ORG clone`.
- `pull`: ✅ `--ff-only` by default. Dirty repos are **skipped** and
  diverged repos fail, both shown in the summary. `--rebase` / `--merge`
  override this. Also `fetch` and `push`.
- `status`: ✅ **compact table** (branch, ahead/behind, staged, modified,
  untracked, missing) built from `git status --porcelain=v2 --branch`.
  **Clean repos are hidden** by default (`--show-clean` shows them); a summary
  line is always printed. `--long` gives raw `git status` per repo.
- `diff [--cached]`, `branch`, `log`, `latest-tag`, `ls-files`, `shortlog`.
- `grep <git-grep args…>`: ✅ backed by `git grep` (`--rg` later). Args are
  passed through verbatim. Output lines are
  prefixed with the repo path (`widget/lib/foo.js:12:…`), so they work with
  editor quickfix. Output comes back in config order even when run in
  parallel. `--heading` groups results per repo. Exit code 0 if anything
  matched, 1 if nothing did (same as grep).
- `gc` (shows before/after sizes), `prune [-n]`.
- `exec -- <cmd> [args…]`: run anything in each repo. `--shell` for pipes.
  This is the escape hatch that makes most one-off commands unnecessary.
- `each --interactive -- tig`: sequential, inherits the TTY.
- `npm install|update|ls|outdated|rebuild` (install if no `node_modules`,
  otherwise update, matching the old behavior). `clean` removes
  `node_modules` and supports dry run.
- ✅ Drop bower. ✅ The long tail of old commands (npm-ls, shortlog-sen, tig,
  …) is covered by `exec` and user aliases instead of built-ins.

Config management (all support `--dry-run`, which prints a unified diff of
`mpm.yaml`):

- `init`: create `mpm.yaml` and `mpm.d/`.
- `list` / `ls`: repos with group, tags, enabled, and cloned state.
- `repo add <group> <ref…> [--tag t] [--disabled] [--clone]`
- `repo rm <name…> [--delete-checkout]`
- `repo enable|disable <name…>`
- `repo tag <name…> --add t --rm t`
- `repo set <name> <key> <value>`
- `group add|rm|enable|disable|list`
- `config get|set|edit|validate|path`
- `doctor`: directories on disk that aren't in the config, configured repos
  that are missing, `origin` URLs that don't match the config, duplicate
  names.

Later:

- `discover <group>`: list the host org's repos that aren't in the config yet
  (via `gh` or the API), optionally add them. Helps with "new repo was added".
- User-defined **command aliases** in config, e.g.
  `aliases: {outdated: "exec -- npm outdated"}`.
- Shell completion (bash, zsh, fish).

## 7. Architecture

```
bin/mpm.js                 # thin entry: builds CLI, sets exit code
lib/
  index.js                 # public library API (programmatic use)
  workspace/               # discovery, load, merge user + workspace config
  config/                  # schema, validation, comment-preserving edits
  repos/                   # ref → URL resolution, selection/filter engine
  run/                     # executor: queue, spawn, abort, dry-run, results
  git/                     # git helpers (status parse, etc.)
  commands/                # one module per command: {name, options, run()}
  output/                  # renderers: text, json, ndjson (TUI later)
  cli/                     # commander wiring generated from the command registry
test/                      # vitest: unit + integration (temp git repos, local bare remotes, no network)
```

Key principles:

1. **Library first.** Commands are plain async functions: they take a
   context and return (or stream) **structured results**. They never print
   directly.
2. **Event stream → renderers.** The runner emits events such as `start`,
   `output`, `result`, and `summary`, each tagged with `repo`. The text
   renderer buffers per-repo output and flushes it in repo order. ✅ On a TTY
   it shows a single updating progress line
   (`pull [142/312] 8 running: widget-api, …`) below the ordered output.
   Never animated for pipes or JSON. The JSON
   renderer emits a versioned schema. A TUI is simply another renderer.
3. **All side effects go through one executor.** Each action declares
   `mutates: true|false`, so dry run is implemented once and can't be
   forgotten by a new command. Config writes are actions too, and their dry
   run shows a diff.
4. **Concurrency.** A `p-queue` with `jobs`. Interactive actions force
   `jobs=1` and `stdio: inherit`. On SIGINT, abort the queue, kill children,
   and print a partial summary.
5. **Exit codes.** `0` ok, `1` some repos failed (or no grep match), `2`
   usage or config error.

## 8. Milestones

1. ✅ **Scaffold**: package.json, eslint, vitest, CI, `bin/mpm.js`,
   `.gitignore`, LICENSE, CHANGELOG.
2. ✅ **Core**: config schema and loading, workspace discovery, repo
   resolution, selection, executor with dry run and queue, text, JSON, and
   NDJSON renderers, TTY progress line.
3. ✅ **First commands**: `init`, `list`, `status`,
   `grep`, `clone`, `pull`, `exec`.
3b. ✅ **Remaining parity**: `fetch`, `push`, `diff`, `branch`, `gc`,
   `prune`, `latest-tag`, `npm install|ci|update|rebuild|ls|outdated`,
   `clean`. Nested subcommands are supported by the CLI builder.
4. ✅ **Config mutation**: `repo add|rm|enable|disable|tag|show`,
   `group list|add|rm|enable|disable|set|tag`,
   `config get|set|unset|path|validate|edit`. Edits go through
   `ConfigEditor`, which uses the `yaml` Document API to keep comments,
   validates the resulting workspace before writing, and shows a unified diff
   in dry run. Still to do: `doctor`.
5. **Polish and release**: README, docs, completion, npm publish under the
   chosen scope.
6. **Future**: `discover`, aliases, TUI, per-repo hooks or setup commands.

## 9. Migration from the bash version

✅ No importer. An `init --import` for the old `mpm-GROUP.conf` files was
prototyped and dropped: existing configs are few and are converted by hand.
The bash script (`bin/mpm`) and its `examples/` were removed when the JS
version was added and remain available in git history (commit `9afad0b`).

Mapping, for hand conversion:

- `*_GITHUB_BASE` → group `source` (e.g. `git@github.com:org` →
  `github:org`).
- `*_CLONE_MODS` → `repos` entries.
- `X_…`/`XXX_…` lists and commented out names → entries with
  `enabled: false`.
- A commented out `source` line in the aggregate `mpm` script → group
  `enabled: false`.
- `./mpm-GROUP cmd` → `mpm -g GROUP cmd`.

## 10. Open questions

- ❓ npm scope and package name. `package.json` is `"private": true` for
  now.
- ❓ JSON output schema details (to design with the first JSON consumers).
- ❓ `discover`: shell out to `gh`, or call the GitHub REST API directly?

## 11. Implementation notes (for later milestones)

- The `github:` protocol is currently a workspace setting. A per-user
  override (user config or `MPM_PROTOCOL`) is needed when a workspace config
  is shared between people who use different protocols.
- Parallel `git` runs set `GIT_TERMINAL_PROMPT=0` so HTTPS credential prompts
  fail instead of hanging. ssh passphrase prompts still need an agent.
- `status` does not fetch, so ↓N is only as fresh as the last fetch. Add
  `fetch` and maybe `status --fetch`.
- For `grep` and `exec`, mpm's options must come before the pass-through
  arguments. For `grep`, global options after the command name are long-only
  (`-n`, `-C`, `-v`, `-q` belong to `git grep`), and `--all` has no `-a`.
- `user aliases` in `mpm.yaml` are accepted by the schema but not wired up
  yet.
