# mpm — Multiple Project Manager

Manage many git repos, grouped by org or project, checked out side by side in
one workspace directory. Clone, update, check status, grep, or run any command
across all of them (or a selected subset), in parallel.

> Status: early rewrite of a long-lived sh script (see
> [CHANGELOG.md](CHANGELOG.md)). See [PLAN.md](PLAN.md) for the design and
> roadmap.

## Install

Requires Node.js >= 22.12 and git. The npm package, `@evotronics/mpm`, is not
published yet; install from a checkout:

```sh
git clone https://github.com/evotronics/mpm.git ~/src/mpm
cd ~/src/mpm && npm install && npm link   # provides `mpm`
```

## Workspace layout

A workspace is a directory with a hidden `.mpm/` config directory:
`.mpm/config.yaml` for settings and `.mpm/groups/<group>.yaml` for repo groups.
Repos are checked out directly in the workspace, so the config stays out of
the way:

```
~/projects/dev/
  .mpm/
    config.yaml
    groups/
      core.yaml
      apps.yaml
  widget/
  widget-account/
  tool-cli/
```

`.mpm/` can be its own git repository, for example to share group files with a
team.

`mpm` finds the workspace from any directory inside it, including from inside
a repo, once the workspace is trusted (see
[Trusted workspaces](#trusted-workspaces)). It can also be chosen with
`-C <dir>` or `MPM_WORKSPACE`.

```yaml
# .mpm/config.yaml
version: 1
settings:
  jobs: 8          # repos processed in parallel
  protocol: ssh    # how "github:owner" sources expand: ssh or https
aliases:           # your own commands; options around them are kept
  up: pull --rebase
  outdated: npm outdated
  tig: [exec, --interactive, --, tig]
```

Personal defaults for all workspaces go in the user config,
`~/.config/mpm/config.yaml` (or `$XDG_CONFIG_HOME/mpm/config.yaml`), which
takes the same `settings` (`protocol`, `jobs`) and `aliases`. A workspace's
`.mpm/config.yaml` overrides it, and `MPM_PROTOCOL` overrides the protocol
everywhere.
This lets people who clone over https and people who use ssh share the same
group files:

```sh
mpm config set --user protocol https   # or: export MPM_PROTOCOL=https
mpm config get --show-origin           # where each setting comes from
```

```yaml
# .mpm/groups/core.yaml
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

The files can be edited by hand or with commands that keep comments and
formatting and validate before writing (add `-n` to see the diff first):

```sh
mpm repo add core new-module --clone
mpm repo disable 'widget-old*'
mpm repo tag 'widget-web-*' --add web
mpm group add extras --source github:other-org --disabled
mpm group enable extras
mpm config set jobs 16
mpm discover                  # new repos in each group's GitHub owner (needs gh)
mpm -n discover core --add    # preview adding them
```

## Usage

```
mpm [global options] <command> [options] [args...]
```

| Command | Description |
|---|---|
| `init [dir]` | Create `.mpm/config.yaml` and `.mpm/groups/` |
| `list` / `ls` | List repos (`--names`, `--paths`, `-l` for URLs) |
| `status` / `st` | Compact table of repos that need attention (`--fetch`, `--show-clean`, `--long`) |
| `clone` | Clone missing repos |
| `pull` | `git pull --ff-only`; skips dirty, detached, or untracked branches (`--rebase`, `--merge`) |
| `fetch` | `git fetch` (`--prune`, `--all-remotes`, `--tags`) |
| `push` | Push repos that are ahead of their upstream |
| `diff` | Uncommitted changes (`--cached`, `--stat`, `--name-only`) |
| `branch` | Repos with branches other than the current one (`--show-clean`, `--remote`) |
| `latest-tag` / `tags` | Latest version tag and commits since it (`--unreleased`) |
| `npm install\|ci\|update\|rebuild\|ls\|outdated` | npm tasks in repos with a `package.json` |
| `clean` | Remove `node_modules` (`--ignored`: all git-ignored files) |
| `gc` | `git gc` with before/after sizes (`--aggressive`) |
| `prune` | Remove stale remote tracking branches (`--remote`) |
| `grep <git grep args>` | `git grep` everywhere, with output paths relative to the current directory |
| `repo add\|rm\|enable\|disable\|tag\|show` | Edit repo entries (`repo add core foo --clone`) |
| `group list\|add\|rm\|enable\|disable\|set\|tag` | Manage groups |
| `config get\|set\|unset\|path\|validate\|edit` | Workspace settings (`config set jobs 16`) |
| `trust [dir]` / `untrust [dir]` | Allow a workspace's `.mpm/config.yaml` to be loaded automatically |
| `doctor` | Find stray checkouts, missing clones, and origin URL mismatches |
| `discover [groups...]` | Find GitHub repos not in the config yet, via `gh` (`--add`, `--clone`) |
| `completion bash\|zsh\|fish` | Print a shell completion script |
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
| `--dirty` | Only repos with uncommitted changes or untracked files |

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

## Trusted workspaces

A workspace config can run commands through aliases, so a `.mpm/config.yaml`
found by walking up from the current directory is only used if its directory
is trusted. Otherwise a cloned repo containing a `.mpm/config.yaml` could take
over whenever you run `mpm` inside it. Untrusted configs are skipped with a
notice, and mpm keeps looking for a trusted workspace further up.

`mpm init` trusts the workspace it creates. For an existing one:

```sh
mpm trust ~/projects/dev     # lists the workspace's aliases, then trusts it
mpm trust --list
mpm untrust ~/projects/dev
```

The trusted list is kept in the user config, which no workspace can change. A
workspace chosen explicitly with `-C <dir>` or `MPM_WORKSPACE` is always used.

## Shell completion

Completes commands, options, repo names, group ids, tags, config keys, and
aliases from the current workspace:

```sh
eval "$(mpm completion bash)"                         # in ~/.bashrc
source <(mpm completion zsh)                          # in ~/.zshrc, after compinit
mpm completion fish > ~/.config/fish/completions/mpm.fish
```

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
