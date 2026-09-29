import {beforeAll, describe, expect, it} from 'vitest';
import {run, tempDir, writeFiles} from '../helpers/fixtures.js';
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const BIN = path.join(import.meta.dirname, '..', '..', 'bin', 'mpm.js');

let ws;

beforeAll(async () => {
  ws = await tempDir();
  await writeFiles(ws, {
    'mpm.yaml': 'version: 1\naliases:\n  up: pull --rebase\n',
    'mpm.d/core.yaml': [
      'title: Example Org',
      'source: github:example-org',
      'tags: [core]',
      'repos:',
      '  - widget',
      '  - widget-web',
      '  - name: widget-old',
      '    enabled: false',
      '    tags: [archived]',
      ''
    ].join('\n'),
    'mpm.d/extras.yaml': 'enabled: false\nrepos: [/srv/sample-data]\n'
  });
});

async function complete(...words) {
  const result = await run(['__complete', '--', ...words], {cwd: ws});
  expect(result.code).toBe(0);
  return result.stdout.split('\n').filter(Boolean)
    .map(line => line.split('\t')[0]);
}

describe('completion engine', () => {
  it('completes commands, subcommands, and aliases', async () => {
    expect(await complete('st')).toEqual(['status']);
    expect(await complete('u')).toEqual(['up']);
    expect(await complete('repo', 'en')).toEqual(['enable']);
    expect(await complete('npm', '')).toEqual(
      ['install', 'ci', 'update', 'rebuild', 'ls', 'outdated']);
  });

  it('completes options and option values', async () => {
    expect(await complete('status', '--gr')).toEqual(['--group']);
    expect(await complete('--output', '')).toEqual(['text', 'json', 'ndjson']);
    expect(await complete('status', '-g', '')).toEqual(['core', 'extras']);
    expect(await complete('status', '--tag', '')).toEqual(['archived', 'core']);
    expect(await complete('status', '-t', 'core,')).toEqual(['core,archived']);
    expect(await complete('status', '-t', '!a')).toEqual(['!archived']);
    expect(await complete('pull', '--from', 'widget-')).toEqual(
      ['widget-web', 'widget-old']);
    expect(await complete('-C', '')).toEqual(['__dirs__']);
  });

  it('completes positional arguments by kind', async () => {
    expect(await complete('status', 'widget', '')).toEqual(
      ['widget', 'widget-web', 'widget-old', 'sample-data']);
    expect(await complete('repo', 'add', '')).toEqual(['core', 'extras']);
    expect(await complete('repo', 'add', 'core', '')).toEqual([]);
    expect(await complete('group', 'enable', 'e')).toEqual(['extras']);
    expect(await complete('config', 'get', 'aliases.')).toEqual(
      ['aliases.up']);
    expect(await complete('completion', '')).toEqual(['bash', 'zsh', 'fish']);
    expect(await complete('init', '')).toEqual(['__dirs__']);
  });

  it('uses file completion for pass-through arguments', async () => {
    expect(await complete('exec', '--', '')).toEqual(['__files__']);
    expect(await complete('exec', 'ls', '')).toEqual(['__files__']);
    expect(await complete('grep', '-n', '')).toEqual(['__files__']);
  });

  it('never fails outside a workspace', async () => {
    const result = await run(['__complete', '--', 'status', '-g', ''],
      {cwd: await tempDir()});
    expect(result).toEqual({code: 0, stdout: '', stderr: ''});
  });
});

describe('completion scripts', () => {
  it('prints scripts for each shell', async () => {
    for(const shell of ['bash', 'zsh', 'fish']) {
      const result = await run(['completion', shell], {cwd: ws});
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/mpm __complete --/);
      expect(result.stdout).toMatch(/multiple-project-manager/);
    }
    const result = await run(['completion', 'tcsh'], {cwd: ws});
    expect(result.code).toBe(2);
  });

  it('completes in bash', async () => {
    const bin = await tempDir();
    await fs.symlink(BIN, path.join(bin, 'mpm'));
    const {stdout: script} = await run(['completion', 'bash'], {cwd: ws});
    await fs.writeFile(path.join(bin, 'mpm.bash'), script);
    const test = `
source ${path.join(bin, 'mpm.bash')}
t() {
  COMP_WORDS=("$@"); COMP_CWORD=$((\${#COMP_WORDS[@]} - 1)); COMPREPLY=()
  _mpm_completion
  printf '%s\\n' "\${COMPREPLY[@]}" | LC_ALL=C sort | xargs
}
t mpm st
t mpm status -g ''
t mpm repo enable widget-
t mpm exec -- mpm.
`;
    const {stdout} = await execFileAsync('bash', ['-c', test], {
      cwd: ws,
      env: {...process.env, PATH: `${bin}:${process.env.PATH}`}
    });
    expect(stdout.split('\n')).toEqual([
      'status',
      'core extras',
      'widget-old widget-web',
      'mpm.d mpm.yaml',
      ''
    ]);
  });
});
