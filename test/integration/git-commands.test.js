import {beforeEach, describe, expect, it} from 'vitest';
import {createWorkspace, git, pushCommit, run, writeFiles}
  from '../helpers/fixtures.js';
import path from 'node:path';

describe('git commands', () => {
  let ws;
  let remotes;

  beforeEach(async () => {
    ({ws, remotes} = await createWorkspace({groups: {
      g: {repos: ['alpha', 'beta']}
    }}));
    await run(['clone'], {cwd: ws});
  });

  it('fetches and reports updated repos', async () => {
    await pushCommit(remotes, 'alpha', {'new.txt': 'x\n'});
    let result = await run(['-n', 'fetch'], {cwd: ws});
    expect(result.stdout).toMatch(/would run: git fetch/);

    result = await run(['fetch'], {cwd: ws});
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('✓ alpha  updated\n' +
      '2 repos: 1 updated, 1 unchanged\n');

    result = await run(['status'], {cwd: ws});
    expect(result.stdout).toMatch(/alpha\s+main\s+↓1/);
  });

  it('pushes repos that are ahead', async () => {
    const alpha = path.join(ws, 'alpha');
    await writeFiles(alpha, {'local.txt': 'l\n'});
    await git(alpha, 'add', '.');
    await git(alpha, 'commit', '-q', '-m', 'local');

    let result = await run(['-n', 'push'], {cwd: ws});
    expect(result.stdout).toMatch(/alpha {2}would push 1 commit \(main\)/);
    expect(result.stdout).toMatch(/would run: git push/);

    result = await run(['push'], {cwd: ws});
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('✓ alpha  pushed 1 commit (main)\n' +
      '2 repos: 1 pushed, 1 with nothing to push\n');
    const remoteLog = await git(path.join(remotes, 'alpha.git'),
      'log', '--oneline', 'main');
    expect(remoteLog).toMatch(/local/);
  });

  it('shows diffs of changed repos', async () => {
    await writeFiles(path.join(ws, 'beta'), {'README.md': 'changed\n'});
    let result = await run(['diff'], {cwd: ws});
    expect(result.stdout).toMatch(/^=== beta\n README.md \| 2/);
    expect(result.stdout).toMatch(/\+changed/);
    expect(result.stderr).toBe('1 of 2 repos changed\n');

    result = await run(['diff', '--name-only'], {cwd: ws});
    expect(result.stdout).toBe('beta/README.md\n');

    result = await run(['diff', '--cached', '--name-only'], {cwd: ws});
    expect(result.stdout).toBe('');
    await git(path.join(ws, 'beta'), 'add', 'README.md');
    result = await run(['diff', '--cached', '--name-only'], {cwd: ws});
    expect(result.stdout).toBe('beta/README.md\n');
  });

  it('lists branches', async () => {
    await git(path.join(ws, 'beta'), 'branch', 'feature');
    let result = await run(['branch'], {cwd: ws});
    expect(result.stdout.split('\n').map(l => l.trimEnd())).toEqual([
      'REPO  CURRENT  OTHER BRANCHES',
      'beta  main     feature',
      '2 repos, 1 shown',
      ''
    ]);
    result = await run(['--json', 'branch', 'alpha'], {cwd: ws});
    expect(JSON.parse(result.stdout).results[0].data)
      .toEqual({current: 'main', branches: ['main']});
  });

  it('runs gc and reports sizes', async () => {
    let result = await run(['-n', 'gc'], {cwd: ws});
    expect(result.stdout).toMatch(/would run: git gc --quiet/);
    result = await run(['gc'], {cwd: ws});
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/✓ alpha {2}[\d.]+ \w+ → [\d.]+ \w+/);
    expect(result.stdout).toMatch(/2 repos: 2 collected: .* \(saved .*\)/);
  });

  it('prunes stale remote branches, with git dry run', async () => {
    const work = path.join(remotes, 'alpha.work');
    await git(work, 'push', '-q', 'origin', 'main:old-branch');
    await run(['fetch'], {cwd: ws});
    await git(work, 'push', '-q', 'origin', '--delete', 'old-branch');

    let result = await run(['-n', 'prune'], {cwd: ws});
    expect(result.stdout).toBe('✓ alpha  would prune 1\n' +
      '  origin/old-branch\n(dry run) 2 repos: 1 ref to prune\n');
    result = await run(['prune'], {cwd: ws});
    expect(result.stdout).toMatch(/alpha {2}pruned 1/);
    result = await run(['prune'], {cwd: ws});
    expect(result.stdout).toBe('2 repos: 0 refs pruned\n');
  });

  it('shows latest version tags and unreleased commits', async () => {
    const alpha = path.join(ws, 'alpha');
    for(const tag of ['v1.9.0', 'v1.10.0', 'v1.2.0']) {
      await git(alpha, 'tag', tag);
    }
    await writeFiles(alpha, {'x.txt': 'x\n'});
    await git(alpha, 'add', '.');
    await git(alpha, 'commit', '-q', '-m', 'after tag');

    let result = await run(['latest-tag'], {cwd: ws});
    expect(result.stdout.split('\n').map(l => l.trimEnd())).toEqual([
      'REPO   TAG      SINCE',
      'alpha  v1.10.0  +1',
      'beta   —',
      ''
    ]);
    result = await run(['latest-tag', '--unreleased'], {cwd: ws});
    expect(result.stdout).not.toMatch(/beta/);
  });
});
