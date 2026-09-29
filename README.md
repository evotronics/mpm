# mpm — Multiple Project Manager

Manage many git repos, grouped by org or project, checked out side by side in
one workspace directory. Clone, update, check status, grep, or run any command
across all of them (or a selected subset), in parallel.

> Status: early rewrite of a long-lived sh script (see
> [CHANGELOG.md](CHANGELOG.md)). See [PLAN.md](PLAN.md) for the design and
> roadmap.

## Install

Requires Node.js >= 22.12 and git.

```sh
git clone <this repo> ~/src/mpm
cd ~/src/mpm && npm install && npm link   # provides `mpm`
```

## Workspace layout

A workspace is a directory with an `mpm.yaml` file. Repo groups are defined in
`mpm.d/<group>.yaml`, and repos are checked out directly in the workspace:

```
~/projects/dev/
  mpm.yaml
  mpm.d/
    core.yaml
    apps.yaml
  widget/
  widget-account/
  tool-cli/
```

`mpm` finds the workspace from any directory inside it, including from inside
a repo. It can also be chosen with `-C <dir>` or `MPM_WORKSPACE`.

```yaml
# mpm.yaml
version: 1
settings:
  jobs: 8          # repos processed in parallel
  protocol: ssh    # how "github:owner" sources expand: ssh or https
```

```yaml
# mpm.d/core.yaml
title: Example Org
source: github:example-org  # or git@host:owner, https://host/owner, /local/dir
tags: [core]
repos:
  - widget                  # resolved against source
  - other-owner/some-repo   # same host, different owner
  - name: widget-old        # long form
    enabled: false
    tags: [archived]
  - url: https://gitlab.com/x/y.git
    name: y
```

A group can be turned off with `enabled: false`. Disabled repos and groups are
skipped by every command unless they are named explicitly or `--all` is given.

## Usage

```
mpm [global options] <command> [options] [args...]
```

| Command | Description |
|---|---|
| `init [dir]` | Create `mpm.yaml` and `mpm.d/` |
| `list` / `ls` | List repos (`--names`, `--paths`, `-l` for URLs) |
| `status` / `st` | Compact table of repos that need attention (`--show-clean`, `--long`) |
| `clone` | Clone missing repos |
| `pull` | `git pull --ff-only`; skips dirty, detached, or untracked branches (`--rebase`, `--merge`) |
| `fetch` | `git fetch` (`--prune`, `--all-remotes`, `--tags`) |
| `push` | Push repos that are ahead of their upstream |
| `diff` | Uncommitted changes (`--cached`, `--stat`, `--name-only`) |
| `branch` | Repos with branches other than the current one (`--show-clean`, `--remote`) |
| `latest-tag` / `tags` | Latest version tag and commits since it (`--unreleased`) |
| `gc` | `git gc` with before/after sizes (`--aggressive`) |
| `prune` | Remove stale remote tracking branches (`--remote`) |
| `grep <git grep args>` | `git grep` everywhere, with output paths relative to the current directory |
| `exec -- <cmd> [args]` | Run a command in each repo (`--shell`, `--prefix`, `-i/--interactive`, `--read-only`) |

Global options: `-C/--workspace`, `-n/--dry-run`, `-j/--jobs`, `-v/--verbose`,
`-q/--quiet`, `--json`, `--output text|json|ndjson`, `--[no-]color`,
`--fail-fast`.

Repo selection options (most commands):

| Option | Meaning |
|---|---|
| `[repos...]`, `-r, --repo <glob>` | Names or globs; `.` means the current repo |
| `-g, --group <id>` | Repos in a group; naming a disabled group selects it |
| `-t, --tag <expr>` | `a,b` = either, `a+b` = both, `!a` = not |
| `-x, --exclude <glob>` | Exclude repos |
| `-a, --all` | Include disabled repos and groups |
| `--from <repo>` | Resume a run at a repo |
| `--missing`, `--cloned` | Filter by checkout state |

Examples:

```sh
mpm clone                        # clone anything new
mpm -j 16 pull                   # update everything
mpm status                       # what needs attention?
mpm grep -n 'createClient'
mpm grep -g core -t '!archived' -- -e pattern -- '*.js'
mpm -n exec -- npm install       # show what would run
mpm exec --read-only --prefix -- git log -1 --format=%cr
mpm exec -i -r widget -- tig
mpm --json status | jq '.results[] | select(.data.behind > 0) | .repo.name'
```

For `grep` and `exec`, mpm's options come first. Everything from the first
unrecognized argument on is passed through unchanged. After `grep`, use the
long forms of global options (`--dry-run`, `--json`, ...), or put them before
`grep`, because short options such as `-n` belong to `git grep`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success (grep: something matched) |
| 1 | Some repos failed (grep: nothing matched) |
| 2 | Usage or config error (grep: errors) |
| 130 | Interrupted |

## Development

```sh
npm test        # vitest
npm run lint    # eslint (@digitalbazaar/eslint-config)
```

## License

BSD 3-Clause. See [LICENSE.md](LICENSE.md).
