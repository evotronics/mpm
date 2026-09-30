import {createWorkspace, run, tempDir, writeFiles}
  from '../helpers/fixtures.js';
import {describe, expect, it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

const EVIL = [
  'version: 1',
  'aliases:',
  '  up: exec --shell -- touch pwned',
  ''
].join('\n');

async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}

async function untrustedWorkspace() {
  const ws = await tempDir();
  await writeFiles(ws, {
    '.mpm/config.yaml': EVIL,
    '.mpm/groups/core.yaml': 'source: /srv/git\nrepos: [widget]\n'
  });
  return ws;
}

describe('workspace trust', () => {
  it('refuses untrusted workspaces found by walking up', async () => {
    const ws = await untrustedWorkspace();
    await fs.mkdir(path.join(ws, 'sub'));
    const result = await run(['list'], {cwd: path.join(ws, 'sub')});
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(`Untrusted workspace "${ws}"`);
    expect(result.stderr).toMatch(`mpm trust "${ws}"`);
  });

  it('uses explicitly chosen workspaces without trust', async () => {
    const ws = await untrustedWorkspace();
    let result = await run(['-C', ws, 'list', '--names'], {cwd: '/'});
    expect(result.stdout).toBe('widget\n');
    result = await run(['list', '--names'],
      {cwd: '/', env: {MPM_WORKSPACE: ws}});
    expect(result.stdout).toBe('widget\n');
  });

  it('never loads aliases from untrusted workspaces', async () => {
    const ws = await untrustedWorkspace();
    const result = await run(['up'], {cwd: ws});
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/unknown command 'up'/);
    expect(await exists(path.join(ws, 'pwned'))).toBe(false);
    const completions = await run(['__complete', '--', 'u'], {cwd: ws});
    expect(completions.stdout).not.toMatch(/^up\t/m);
  });

  it('skips an untrusted config inside a trusted workspace', async () => {
    const {ws} = await createWorkspace({groups: {core: {repos: ['alpha']}}});
    await run(['clone'], {cwd: ws});
    const nested = path.join(ws, 'alpha');
    await writeFiles(nested, {'.mpm/config.yaml': EVIL});

    let result = await run(['list', '--names'], {cwd: nested});
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('alpha\n');
    expect(result.stderr).toMatch(
      `Ignoring untrusted ${path.join(nested, '.mpm', 'config.yaml')}`);

    result = await run(['up'], {cwd: nested});
    expect(result.code).toBe(2);
    expect(await exists(path.join(nested, 'pwned'))).toBe(false);
  });

  it('trusts and untrusts workspaces', async () => {
    const ws = await untrustedWorkspace();
    let result = await run(['-n', 'trust'], {cwd: ws});
    expect(result.stdout).toMatch(/This workspace defines aliases:\n {2}up: /);
    expect(result.stdout).toMatch(`would trust ${ws}`);
    expect((await run(['list'], {cwd: ws})).code).toBe(2);

    result = await run(['trust', ws], {cwd: '/'});
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(`trusted ${ws}`);
    expect((await run(['list', '--names'], {cwd: ws})).stdout)
      .toBe('widget\n');

    result = await run(['trust'], {cwd: ws});
    expect(result.stdout).toMatch(`${ws} is already trusted`);
    result = await run(['trust', '--list'], {cwd: '/'});
    expect(result.stdout.split('\n')).toContain(ws);

    result = await run(['untrust', ws], {cwd: '/'});
    expect(result.stdout).toMatch(`untrusted ${ws}`);
    expect((await run(['list'], {cwd: ws})).code).toBe(2);
  });

  it('matches trusted directories through symlinks', async () => {
    const ws = await untrustedWorkspace();
    const link = path.join(await tempDir(), 'link');
    await fs.symlink(ws, link);
    await run(['trust', link], {cwd: '/'});
    expect((await run(['list', '--names'], {cwd: ws})).stdout)
      .toBe('widget\n');
    expect((await run(['list', '--names'], {cwd: link})).stdout)
      .toBe('widget\n');
  });

  it('requires a workspace config to trust', async () => {
    const result = await run(['trust'], {cwd: await tempDir()});
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/No "\.mpm\/config\.yaml"/);
  });
});
