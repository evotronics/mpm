import {beforeEach, describe, expect, it} from 'vitest';
import {createRemote, createWorkspace, git, run, writeFiles}
  from '../helpers/fixtures.js';
import fs from 'node:fs/promises';
import path from 'node:path';

async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}

const CORE_YAML = remotes => `# Example Org repos.
title: Core
source: ${remotes}
tags: [core]
repos:
  - alpha # the first
  # gamma is important
  - gamma
`;

describe('config editing commands', () => {
  let ws;
  let remotes;
  let coreFile;

  beforeEach(async () => {
    ({ws, remotes} = await createWorkspace({groups: {
      core: {repos: ['alpha', 'gamma']}
    }}));
    await createRemote(remotes, 'beta');
    coreFile = path.join(ws, '.mpm', 'groups', 'core.yaml');
    await fs.writeFile(coreFile, CORE_YAML(remotes));
  });

  const read = () => fs.readFile(coreFile, 'utf8');

  describe('repo', () => {
    it('adds repos in sorted position keeping comments', async () => {
      let result = await run(['-n', 'repo', 'add', 'core', 'beta', '-t', 'new'],
        {cwd: ws});
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/would add beta to core/);
      expect(result.stdout).toMatch(/\+ {2}- name: beta\n\+ {4}tags: \[new\]/);
      expect(await read()).toBe(CORE_YAML(remotes));

      result = await run(['repo', 'add', 'core', 'beta', 'zeta', '--disabled'],
        {cwd: ws});
      expect(result.code).toBe(0);
      expect(await read()).toBe(`# Example Org repos.
title: Core
source: ${remotes}
tags: [core]
repos:
  - alpha # the first
  - name: beta
    enabled: false
  # gamma is important
  - gamma
  - name: zeta
    enabled: false
`);
    });

    it('stores URLs matching the group source as names', async () => {
      await fs.writeFile(coreFile, 'source: github:example-org\nrepos: []\n');
      const result = await run(['repo', 'add', 'core',
        'https://github.com/example-org/foo.git',
        'git@github.com:example-org/bar',
        'git@github.com:other/baz.git'], {cwd: ws});
      expect(result.code).toBe(0);
      expect(await read()).toBe('source: github:example-org\nrepos:\n' +
        '  - bar\n  - git@github.com:other/baz.git\n  - foo\n');
    });

    it('rejects duplicates and unknown groups without writing', async () => {
      let result = await run(['repo', 'add', 'core', 'alpha'], {cwd: ws});
      expect(result.code).toBe(2);
      expect(result.stderr).toMatch(/"alpha" already exists in group "core"/);
      result = await run(['repo', 'add', 'nope', 'x'], {cwd: ws});
      expect(result.code).toBe(2);
      expect(await read()).toBe(CORE_YAML(remotes));
    });

    it('adds and clones', async () => {
      const result = await run(['repo', 'add', '--clone', 'core', 'beta'],
        {cwd: ws});
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/✓ beta {2}cloned/);
      expect(await exists(path.join(ws, 'beta', '.git'))).toBe(true);
    });

    it('enables, disables, and tags repos in their shortest form', async () => {
      await run(['repo', 'disable', 'gamma'], {cwd: ws});
      expect(await read()).toMatch(
        /# gamma is important\n {2}- name: gamma\n {4}enabled: false\n/);
      let result = await run(['list', '--names'], {cwd: ws});
      expect(result.stdout).toBe('alpha\n');

      await run(['repo', 'tag', 'gamma', '--add', 'x'], {cwd: ws});
      await run(['repo', 'enable', 'gamma'], {cwd: ws});
      expect(await read()).toMatch(/- name: gamma\n {4}tags: \[x\]\n$/);
      await run(['repo', 'tag', 'gamma', '--remove', 'x'], {cwd: ws});
      expect(await read()).toBe(CORE_YAML(remotes));

      result = await run(['repo', 'enable', 'alpha'], {cwd: ws});
      expect(result.stdout).toBe('alpha is already enabled\n' +
        'No config changes.\n');
    });

    it('explains group tags when tagging repos', async () => {
      const result = await run(['repo', 'tag', 'alpha', '--remove', 'core'],
        {cwd: ws});
      expect(result.stderr).toMatch(/comes from group "core"/);
    });

    it('shows repo details', async () => {
      const result = await run(['--json', 'repo', 'show', 'gamma'],
        {cwd: ws});
      expect(JSON.parse(result.stdout).data[0]).toMatchObject({
        name: 'gamma', group: 'core', enabled: true, cloned: false,
        tags: ['core']
      });
    });

    it('removes repos, deleting checkouts only when safe', async () => {
      await run(['clone'], {cwd: ws});
      await writeFiles(path.join(ws, 'gamma'), {'untracked.txt': 'x'});
      let result = await run(['repo', 'rm', '--delete', 'gamma'], {cwd: ws});
      expect(result.code).toBe(2);
      expect(result.stderr).toMatch(/gamma: untracked files/);
      expect(await read()).toBe(CORE_YAML(remotes));

      result = await run(['-n', 'repo', 'rm', '--delete', '--force', 'gamma'],
        {cwd: ws});
      expect(result.stdout).toMatch(/would delete gamma\//);
      expect(await exists(path.join(ws, 'gamma'))).toBe(true);

      result = await run(['repo', 'rm', '--delete', '--force', 'gamma'],
        {cwd: ws});
      expect(result.code).toBe(0);
      expect(await exists(path.join(ws, 'gamma'))).toBe(false);
      expect(await read()).not.toMatch(/gamma/);

      // without --delete the checkout stays
      await run(['repo', 'rm', 'alpha'], {cwd: ws});
      expect(await exists(path.join(ws, 'alpha', '.git'))).toBe(true);
    });

    it('refuses to delete checkouts with unpushed commits', async () => {
      await run(['clone'], {cwd: ws});
      const alpha = path.join(ws, 'alpha');
      await writeFiles(alpha, {'new.txt': 'x'});
      await git(alpha, 'add', '.');
      await git(alpha, 'commit', '-q', '-m', 'local');
      const result = await run(['repo', 'rm', '--delete', 'alpha'],
        {cwd: ws});
      expect(result.stderr).toMatch(/alpha: unpushed commits/);
    });
  });

  describe('group', () => {
    it('adds, lists, changes, and removes groups', async () => {
      let result = await run(['group', 'add', 'extras', '--source',
        'github:other-org', '-t', 'extras', '--disabled'], {cwd: ws});
      expect(result.code).toBe(0);
      const extrasFile = path.join(ws, '.mpm', 'groups', 'extras.yaml');
      expect(await fs.readFile(extrasFile, 'utf8')).toBe(
        'source: github:other-org\nenabled: false\ntags: [extras]\n' +
        'repos: []\n');

      result = await run(['--json', 'group', 'list'], {cwd: ws});
      expect(JSON.parse(result.stdout).data.map(g => [g.id, g.enabled]))
        .toEqual([['core', true], ['extras', false]]);

      await run(['group', 'enable', 'extras'], {cwd: ws});
      await run(['group', 'set', 'extras', '--title', 'Extras'], {cwd: ws});
      await run(['group', 'tag', 'extras', '--add', 'x', '--remove', 'extras'],
        {cwd: ws});
      expect(await fs.readFile(extrasFile, 'utf8')).toBe(
        'source: github:other-org\ntags: [x]\ntitle: Extras\n' +
        'repos: []\n');

      result = await run(['group', 'rm', 'core'], {cwd: ws});
      expect(result.code).toBe(2);
      expect(result.stderr).toMatch(/core: 2 repos/);
      result = await run(['group', 'rm', 'extras'], {cwd: ws});
      expect(result.code).toBe(0);
      expect(await exists(extrasFile)).toBe(false);
    });

    it('rejects existing and invalid group ids', async () => {
      let result = await run(['group', 'add', 'core'], {cwd: ws});
      expect(result.stderr).toMatch(/already exists/);
      result = await run(['group', 'add', '../x'], {cwd: ws});
      expect(result.stderr).toMatch(/Invalid group id/);
    });

    it('disables a group and its repos', async () => {
      await run(['group', 'disable', 'core'], {cwd: ws});
      expect(await read()).toMatch(/tags: \[core\]\nenabled: false\nrepos:/);
      const result = await run(['list', '--names'], {cwd: ws});
      expect(result.stdout).toBe('');
    });
  });

  describe('config', () => {
    const configFile = () =>
      fs.readFile(path.join(ws, '.mpm', 'config.yaml'), 'utf8');

    it('gets, sets, and unsets settings with validation', async () => {
      let result = await run(['config', 'get', 'protocol'], {cwd: ws});
      expect(result.stdout).toBe('ssh\n');

      await run(['config', 'set', 'protocol', 'https'], {cwd: ws});
      result = await run(['config', 'get', 'settings.protocol'], {cwd: ws});
      expect(result.stdout).toBe('https\n');

      const before = await configFile();
      result = await run(['config', 'set', 'jobs', '0'], {cwd: ws});
      expect(result.code).toBe(2);
      expect(result.stderr).toMatch(/\/settings\/jobs: must be >= 1/);
      result = await run(['config', 'set', 'bogus', 'x'], {cwd: ws});
      expect(result.stderr).toMatch(/unknown property "bogus"/);
      expect(await configFile()).toBe(before);

      await run(['config', 'set', 'aliases.up', 'pull --rebase'], {cwd: ws});
      expect(await configFile()).toMatch(/aliases:\n {2}up: pull --rebase/);
      await run(['config', 'unset', 'aliases.up'], {cwd: ws});
      expect(await configFile()).not.toMatch(/aliases/);

      result = await run(['config', 'get', 'aliases.nope'], {cwd: ws});
      expect(result.code).toBe(2);
    });

    it('validates and shows paths', async () => {
      let result = await run(['config', 'validate'], {cwd: ws});
      expect(result.stdout).toBe('✓ config is valid: 1 groups, 2 repos\n');
      result = await run(['--json', 'config', 'path'], {cwd: ws});
      expect(JSON.parse(result.stdout).data.groups)
        .toEqual({core: coreFile});
    });

    it('opens an editor and validates after', async () => {
      let result = await run(['config', 'edit', 'core'],
        {cwd: ws, env: {EDITOR: 'true', VISUAL: ''}});
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('.mpm/groups/core.yaml is valid\n');

      result = await run(['config', 'edit'], {cwd: ws, env: {
        VISUAL: '', EDITOR: 'sh -c \'echo "bogus: 1" >> "$0"\''
      }});
      expect(result.code).toBe(2);
      expect(result.stderr).toMatch(/unknown property "bogus"/);
      expect(result.stderr).toMatch(/Fix it with: mpm config edit/);
    });
  });
});
