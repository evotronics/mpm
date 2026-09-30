import {beforeEach, describe, expect, it} from 'vitest';
import {run, tempDir, writeFiles} from '../helpers/fixtures.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('user config and protocol override', () => {
  let ws;
  let env;
  let userFile;

  beforeEach(async () => {
    const dir = await tempDir();
    ws = path.join(dir, 'ws');
    // explicitly chosen workspaces need no trust entry
    env = {XDG_CONFIG_HOME: path.join(dir, 'config'), MPM_WORKSPACE: ws};
    userFile = path.join(dir, 'config', 'mpm', 'config.yaml');
    await writeFiles(ws, {
      '.mpm/config.yaml': 'version: 1\n',
      '.mpm/groups/core.yaml': 'source: github:example-org\nrepos: [widget]\n'
    });
  });

  async function url(extraEnv = {}) {
    const result = await run(['--json', 'list'],
      {cwd: ws, env: {...env, ...extraEnv}});
    expect(result.code).toBe(0);
    return JSON.parse(result.stdout).data[0].url;
  }

  it('applies env > workspace > user > default', async () => {
    expect(await url()).toBe('git@github.com:example-org/widget.git');

    await writeFiles(path.dirname(userFile),
      {'config.yaml': 'version: 1\nsettings:\n  protocol: https\n'});
    expect(await url()).toBe('https://github.com/example-org/widget.git');

    await fs.appendFile(path.join(ws, '.mpm', 'config.yaml'),
      'settings:\n  protocol: ssh\n');
    expect(await url()).toBe('git@github.com:example-org/widget.git');

    expect(await url({MPM_PROTOCOL: 'https'}))
      .toBe('https://github.com/example-org/widget.git');
  });

  it('shows where settings come from', async () => {
    await writeFiles(path.dirname(userFile),
      {'config.yaml': 'version: 1\nsettings:\n  jobs: 3\n'});
    let result = await run(['config', 'get', '--show-origin'],
      {cwd: ws, env: {...env, MPM_PROTOCOL: 'https'}});
    expect(result.stdout).toBe([
      'jobs: 3  (' + userFile + ')',
      'protocol: https  (env MPM_PROTOCOL)',
      'layout: flat  (default)',
      ''
    ].join('\n'));
    result = await run(['--json', 'config', 'get', 'jobs', '--show-origin'],
      {cwd: ws, env});
    expect(JSON.parse(result.stdout).data)
      .toEqual({value: 3, origin: userFile});
  });

  it('rejects invalid values', async () => {
    let result = await run(['list'],
      {cwd: ws, env: {...env, MPM_PROTOCOL: 'ftp'}});
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Invalid MPM_PROTOCOL "ftp"/);

    await writeFiles(path.dirname(userFile),
      {'config.yaml': 'version: 1\nsettings:\n  layout: flat\n'});
    result = await run(['list'], {cwd: ws, env});
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/unknown property "layout"/);
  });

  it('edits the user config outside a workspace', async () => {
    const outside = await tempDir();
    let result = await run(['-n', 'config', 'set', '--user', 'protocol',
      'https'], {cwd: outside, env});
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/would create .*config\.yaml/);
    await expect(fs.access(userFile)).rejects.toThrow();

    result = await run(['config', 'set', '--user', 'protocol', 'https'],
      {cwd: outside, env});
    expect(result.code).toBe(0);
    expect(await fs.readFile(userFile, 'utf8'))
      .toBe('version: 1\nsettings:\n  protocol: https\n');

    result = await run(['config', 'get', '--user', 'protocol'],
      {cwd: outside, env});
    expect(result.stdout).toBe('https\n');

    result = await run(['config', 'set', '--user', 'protocol', 'ftp'],
      {cwd: outside, env});
    expect(result.code).toBe(2);

    await run(['config', 'unset', '--user', 'protocol'], {cwd: outside, env});
    expect(await fs.readFile(userFile, 'utf8')).toBe('version: 1\n');

    result = await run(['config', 'path'], {cwd: ws, env});
    expect(result.stdout).toMatch(`user:      ${userFile}\n`);
  });

  it('honors MPM_USER_CONFIG', async () => {
    const other = path.join(await tempDir(), 'mine.yaml');
    await fs.writeFile(other, 'settings:\n  protocol: https\n');
    expect(await url({MPM_USER_CONFIG: other}))
      .toBe('https://github.com/example-org/widget.git');
  });

  it('expands user aliases, with workspace aliases taking precedence',
    async () => {
      await writeFiles(path.dirname(userFile), {'config.yaml': [
        'version: 1',
        'aliases:',
        '  names: list --names',
        '  where: config path',
        ''
      ].join('\n')});
      let result = await run(['names'], {cwd: ws, env});
      expect(result.stdout).toBe('widget\n');

      await fs.appendFile(path.join(ws, '.mpm', 'config.yaml'),
        'aliases:\n  names: list --paths\n');
      result = await run(['names'], {cwd: ws, env});
      expect(result.stdout).toBe(`${path.join(ws, 'widget')}\n`);

      result = await run(['config', 'get', 'aliases.where'], {cwd: ws, env});
      expect(result.stdout).toBe('config path\n');
    });
});
