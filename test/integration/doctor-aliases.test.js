import {beforeEach, describe, expect, it} from 'vitest';
import {createRemote, createWorkspace, git, run} from '../helpers/fixtures.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('doctor', () => {
  let ws;
  let remotes;

  beforeEach(async () => {
    ({ws, remotes} = await createWorkspace({groups: {
      g: {repos: ['alpha', 'beta', {name: 'old', enabled: false}]}
    }}));
  });

  it('reports a healthy workspace', async () => {
    await run(['clone'], {cwd: ws});
    const result = await run(['doctor'], {cwd: ws});
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      '✓ no problems found in 3 repos (.mpm/config.yaml)\n');
  });

  it('finds workspace problems', async () => {
    await run(['clone', 'alpha', 'old'], {cwd: ws});
    // unknown checkout, unknown plain directory, bad origin
    await createRemote(remotes, 'stray');
    await git(ws, 'clone', '-q', path.join(remotes, 'stray.git'), 'stray');
    await fs.mkdir(path.join(ws, 'notes'));
    await git(path.join(ws, 'alpha'), 'remote', 'set-url', 'origin',
      '/elsewhere/alpha.git');

    const result = await run(['--json', 'doctor'], {cwd: ws});
    expect(result.code).toBe(1);
    const findings = JSON.parse(result.stdout).data.findings;
    expect(findings.map(f => [f.severity, f.type, f.path])).toEqual([
      ['warning', 'origin-mismatch', 'alpha'],
      ['warning', 'missing', 'beta'],
      ['warning', 'unknown-repo', 'stray'],
      ['info', 'unknown-directory', 'notes'],
      ['info', 'disabled-checkout', 'old']
    ]);
    expect(findings[2].suggestion)
      .toBe(`mpm repo add <group> ${path.join(remotes, 'stray.git')}`);

    const text = await run(['doctor'], {cwd: ws});
    expect(text.stdout).toMatch(
      /warning beta: enabled repo is not cloned\n {8}fix: mpm clone beta/);
    expect(text.stdout).toMatch(/0 errors, 3 warnings, 2 notes\n$/);
  });

  it('treats protocol-only origin differences as notes', async () => {
    await fs.writeFile(path.join(ws, '.mpm', 'groups', 'g.yaml'),
      'source: github:example\nrepos: [alpha]\n');
    await fs.mkdir(path.join(ws, 'alpha'));
    await git(path.join(ws, 'alpha'), 'init', '-q');
    await git(path.join(ws, 'alpha'), 'remote', 'add', 'origin',
      'https://github.com/example/alpha');
    const result = await run(['--json', 'doctor'], {cwd: ws});
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).data.findings.map(f => f.type))
      .toEqual(['origin-protocol']);
  });
});

describe('aliases', () => {
  let ws;

  beforeEach(async () => {
    ({ws} = await createWorkspace({groups: {g: {repos: ['alpha', 'beta']}}}));
    await fs.appendFile(path.join(ws, '.mpm', 'config.yaml'), [
      'aliases:',
      '  names: list --names',
      '  hello: exec --read-only --prefix -- sh -c "echo hi $MPM_REPO"',
      '  arr: [list, --names, --exclude, beta]',
      '  loop1: loop2',
      '  loop2: loop1',
      '  list: status',
      ''
    ].join('\n'));
  });

  it('expands aliases, keeping surrounding arguments', async () => {
    let result = await run(['names'], {cwd: ws});
    expect(result.stdout).toBe('alpha\nbeta\n');
    result = await run(['-C', ws, 'names', 'b*'], {cwd: '/'});
    expect(result.stdout).toBe('beta\n');
    result = await run(['arr'], {cwd: ws});
    expect(result.stdout).toBe('alpha\n');
    await run(['clone'], {cwd: ws});
    result = await run(['hello'], {cwd: ws});
    expect(result.stdout).toMatch(/^alpha: hi alpha\nbeta: hi beta\n/);
  });

  it('lets built-in commands win and detects loops', async () => {
    let result = await run(['list', '--names'], {cwd: ws});
    expect(result.stdout).toBe('alpha\nbeta\n');
    result = await run(['loop1'], {cwd: ws});
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Alias loop: loop1 -> loop2 -> loop1/);
    result = await run(['nope'], {cwd: ws});
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/unknown command 'nope'/);
  });
});
