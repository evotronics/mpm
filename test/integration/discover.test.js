import {beforeEach, describe, expect, it} from 'vitest';
import {run, tempDir, writeFiles} from '../helpers/fixtures.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const FAKE_GH = path.join(import.meta.dirname, '..', 'helpers', 'fake-gh.js');

function upstream(owner, repos) {
  return JSON.stringify(repos.map(repo => ({
    name: repo.name,
    description: repo.description ?? '',
    isArchived: Boolean(repo.archived),
    isFork: Boolean(repo.fork),
    url: `https://github.com/${owner}/${repo.name}`
  })));
}

describe('discover', () => {
  let ws;
  let env;
  let ghDir;

  beforeEach(async () => {
    ws = await tempDir();
    ghDir = await tempDir();
    // a symlink, since the temp dir may be mounted noexec
    await fs.symlink(FAKE_GH, path.join(ghDir, 'gh'));
    env = {PATH: `${ghDir}:${process.env.PATH}`, FAKE_GH_DIR: ghDir};
    await writeFiles(ws, {
      'mpm.yaml': 'version: 1\n',
      'mpm.d/core.yaml': [
        '# Core repos.',
        'source: github:example-org',
        'repos:',
        '  - widget',
        '  - widget-gone',
        '  - widget-old',
        '  - zeta',
        ''
      ].join('\n'),
      'mpm.d/apps.yaml': 'source: git@github.com:other-org\n' +
        'repos: [tool-cli]\n',
      'mpm.d/local.yaml': 'source: /srv/git\nrepos: [misc]\n'
    });
    await writeFiles(ghDir, {
      'example-org.json': upstream('example-org', [
        {name: 'widget'},
        {name: 'widget-new', description: 'A new widget'},
        {name: 'widget-old', archived: true},
        {name: 'widget-archived', archived: true},
        {name: 'widget-fork', fork: true},
        {name: 'tool-cli'},
        {name: 'zeta'}
      ]),
      'other-org.json': upstream('other-org', [{name: 'tool-cli'}])
    });
  });

  it('reports new, conflicting, gone, and archived repos', async () => {
    const result = await run(['discover'], {cwd: ws, env});
    expect(result.code).toBe(0);
    expect(result.stdout).toBe([
      'apps (github:other-org): up to date',
      'core (github:example-org): 1 new (1 archived and 1 fork not shown; ' +
        '--archived, --forks)',
      '  + widget-new  A new widget',
      '  ! tool-cli  name already used by group apps ' +
        '(git@github.com:other-org/tool-cli.git)',
      '  - widget-gone  configured but not found upstream',
      '  ~ widget-old  archived upstream; disable with: ' +
        'mpm repo disable widget-old',
      '1 new repo; add with: mpm discover --add (or --clone)',
      ''
    ].join('\n'));
    const calls = await fs.readFile(path.join(ghDir, 'calls.log'), 'utf8');
    expect(calls.split('\n').filter(Boolean).sort()).toEqual([
      'repo list example-org --limit 1000 --json ' +
        'name,description,isArchived,isFork,url',
      'repo list other-org --limit 1000 --json ' +
        'name,description,isArchived,isFork,url'
    ]);
  });

  it('includes archived repos and forks on request, as JSON', async () => {
    const result = await run(['--json', 'discover', 'core', '--archived',
      '--forks'], {cwd: ws, env});
    const [core] = JSON.parse(result.stdout).data.groups;
    expect(core.new.map(r => [r.name, r.archived, r.fork])).toEqual([
      ['widget-archived', true, false],
      ['widget-fork', false, true],
      ['widget-new', false, false]
    ]);
    expect(core.hidden).toEqual({archived: 0, forks: 0});
  });

  it('adds new repos to the group, with dry run', async () => {
    const coreFile = path.join(ws, 'mpm.d', 'core.yaml');
    const before = await fs.readFile(coreFile, 'utf8');
    let result = await run(['-n', 'discover', 'core', '--add', '-t', 'new'],
      {cwd: ws, env});
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/would add widget-new to core/);
    expect(result.stdout).toMatch(
      /\+ {2}- name: widget-new\n\+ {4}tags: \[new\]/);
    expect(await fs.readFile(coreFile, 'utf8')).toBe(before);

    result = await run(['discover', 'core', '--add', '--disabled'],
      {cwd: ws, env});
    expect(result.code).toBe(0);
    expect(await fs.readFile(coreFile, 'utf8')).toBe([
      '# Core repos.',
      'source: github:example-org',
      'repos:',
      '  - widget',
      '  - widget-gone',
      '  - name: widget-new',
      '    enabled: false',
      '  - widget-old',
      '  - zeta',
      ''
    ].join('\n'));

    result = await run(['-n', 'discover', 'core', '--clone'], {cwd: ws, env});
    expect(result.stdout).not.toMatch(/widget-new/);
  });

  it('previews cloning added repos', async () => {
    const result = await run(['-n', 'discover', 'core', '--clone'],
      {cwd: ws, env});
    expect(result.stdout).toMatch(/would add widget-new to core/);
    expect(result.stdout).toMatch(new RegExp('would run: git clone -- ' +
      'git@github\\.com:example-org/widget-new\\.git widget-new'));
    await expect(fs.access(path.join(ws, 'widget-new'))).rejects.toThrow();
  });

  it('refuses to guess the group for a shared owner', async () => {
    await fs.writeFile(path.join(ws, 'mpm.d', 'apps.yaml'),
      'source: github:example-org\nrepos: []\n');
    let result = await run(['discover', '--add'], {cwd: ws, env});
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(
      /Groups apps, core all use github:example-org; name the one/);
    result = await run(['discover', 'core', '--add'], {cwd: ws, env});
    expect(result.code).toBe(0);
  });

  it('reports gh errors and missing gh', async () => {
    await fs.rm(path.join(ghDir, 'other-org.json'));
    let result = await run(['discover'], {cwd: ws, env});
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(
      /apps \(github:other-org\): gh repo list failed: GraphQL: Could not/);

    result = await run(['discover', 'local'], {cwd: ws, env});
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/"local" does not have a GitHub source/);

    result = await run(['discover'], {cwd: ws, env: {PATH: '/nonexistent'}});
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/needs the GitHub CLI \(gh\)/);
  });
});
