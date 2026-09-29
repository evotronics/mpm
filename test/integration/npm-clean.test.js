import {beforeEach, describe, expect, it} from 'vitest';
import {createWorkspace, run, writeFiles} from '../helpers/fixtures.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const NPM_ENV = {
  npm_config_offline: 'true',
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  npm_config_update_notifier: 'false'
};

async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}

describe('npm and clean', () => {
  let ws;

  beforeEach(async () => {
    ({ws} = await createWorkspace({
      groups: {g: {repos: ['alpha', 'beta']}},
      files: {
        alpha: {
          'package.json': JSON.stringify({name: 'alpha', version: '1.0.0'}),
          '.gitignore': 'node_modules/\ndist/\n'
        }
      }
    }));
    await run(['clone'], {cwd: ws});
  });

  it('runs npm in repos with a package.json', async () => {
    let result = await run(['-n', 'npm', 'install'], {cwd: ws, env: NPM_ENV});
    expect(result.stdout).toBe('✓ alpha\n  would run: npm install\n' +
      '(dry run) 2 repos: 1 to install\n');

    result = await run(['npm', 'install'], {cwd: ws, env: NPM_ENV});
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('✓ alpha  installed\n2 repos: 1 installed\n');
    expect(await exists(path.join(ws, 'alpha', 'package-lock.json')))
      .toBe(true);

    result = await run(['npm', '-v', 'ls'], {cwd: ws, env: NPM_ENV});
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/✓ alpha {2}ok\n[^]*alpha@1\.0\.0/);
    expect(result.stdout).toMatch(/- beta {2}skipped: no package\.json/);
  });

  it('removes node_modules, honoring dry run', async () => {
    await writeFiles(path.join(ws, 'alpha'),
      {'node_modules/x/index.js': 'x'.repeat(1000)});

    let result = await run(['-n', 'clean'], {cwd: ws});
    expect(result.stdout).toBe(
      '✓ alpha  would remove node_modules/ (1000 B)\n' +
      '  would remove node_modules\n' +
      '(dry run) 2 repos: 1 to clean (1000 B), 1 already clean\n');
    expect(await exists(path.join(ws, 'alpha', 'node_modules'))).toBe(true);

    result = await run(['clean'], {cwd: ws});
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/alpha {2}removed node_modules\/ \(1000 B\)/);
    expect(await exists(path.join(ws, 'alpha', 'node_modules'))).toBe(false);
  });

  it('removes all ignored files with --ignored', async () => {
    await writeFiles(path.join(ws, 'alpha'), {
      'dist/out.js': 'x',
      'node_modules/y/index.js': 'y',
      'untracked.txt': 'keep me'
    });
    let result = await run(['-n', 'clean', '--ignored'], {cwd: ws});
    expect(result.stdout).toMatch(
      /alpha {2}would remove 2 paths\n {2}dist\/\n {2}node_modules\//);
    expect(await exists(path.join(ws, 'alpha', 'dist'))).toBe(true);

    result = await run(['clean', '--ignored'], {cwd: ws});
    expect(result.code).toBe(0);
    expect(await exists(path.join(ws, 'alpha', 'dist'))).toBe(false);
    expect(await exists(path.join(ws, 'alpha', 'untracked.txt'))).toBe(true);
  });

  it('accepts global options on command groups', async () => {
    const result = await run(['npm', '--dry-run', 'install'],
      {cwd: ws, env: NPM_ENV});
    expect(result.stdout).toMatch(/would run: npm install/);
  });
});
