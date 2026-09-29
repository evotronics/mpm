import {beforeEach, describe, expect, it} from 'vitest';
import {createWorkspace, git, pushCommit, run, tempDir, writeFiles}
  from '../helpers/fixtures.js';
import fs from 'node:fs/promises';
import path from 'node:path';

async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}

describe('workspace discovery and config', () => {
  it('errors outside a workspace', async () => {
    const dir = await tempDir();
    const {code, stderr} = await run(['list'], {cwd: dir});
    expect(code).toBe(2);
    expect(stderr).toMatch(/Not in an mpm workspace/);
  });

  it('finds the workspace from a subdirectory and with -C', async () => {
    const {ws} = await createWorkspace({groups: {g: {repos: ['a']}}});
    await fs.mkdir(path.join(ws, 'a', 'deep'), {recursive: true});
    let result = await run(['list', '--names'],
      {cwd: path.join(ws, 'a', 'deep')});
    expect(result.stdout).toBe('a\n');
    result = await run(['-C', ws, 'list', '--names'], {cwd: '/'});
    expect(result.stdout).toBe('a\n');
    result = await run(['list', '--names'],
      {cwd: '/', env: {MPM_WORKSPACE: ws}});
    expect(result.stdout).toBe('a\n');
  });

  it('reports invalid config with file and location', async () => {
    const {ws} = await createWorkspace({groups: {
      g: {repos: ['a']},
      h: {repos: ['a']}
    }});
    let result = await run(['list'], {cwd: ws});
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(
      /mpm\.d\/h\.yaml: \/repos\/0: duplicate repo name "a"/);

    await fs.writeFile(path.join(ws, 'mpm.d', 'h.yaml'), 'repos: [b\n');
    result = await run(['list'], {cwd: ws});
    expect(result.stderr).toMatch(/Invalid YAML in "mpm\.d\/h\.yaml"/);

    await fs.writeFile(path.join(ws, 'mpm.d', 'h.yaml'), 'repo: [b]\n');
    result = await run(['--json', 'list'], {cwd: ws});
    expect(result.code).toBe(2);
    const json = JSON.parse(result.stdout);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('CONFIG_ERROR');
    expect(json.error.details).toEqual(
      ['mpm.d/h.yaml: (top level): unknown property "repo"']);
  });
});

describe('init', () => {
  it('creates a workspace and refuses to overwrite', async () => {
    const dir = await tempDir();
    let result = await run(['init', '--protocol', 'https'], {cwd: dir});
    expect(result.code).toBe(0);
    const text = await fs.readFile(path.join(dir, 'mpm.yaml'), 'utf8');
    expect(text).toMatch(/protocol: https/);
    expect(await exists(path.join(dir, 'mpm.d'))).toBe(true);
    result = await run(['list'], {cwd: dir});
    expect(result.code).toBe(0);
    result = await run(['init'], {cwd: dir});
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Refusing to overwrite/);
  });

  it('shows what would be written in dry run', async () => {
    const dir = await tempDir();
    const result = await run(['-n', 'init', 'ws'], {cwd: dir});
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      `would write ${path.join(dir, 'ws', 'mpm.yaml')}\n`);
    expect(await exists(path.join(dir, 'ws'))).toBe(false);
  });
});

describe('repo commands', () => {
  let ws;
  let remotes;

  beforeEach(async () => {
    ({ws, remotes} = await createWorkspace({groups: {
      core: {tags: ['core'], repos: ['alpha', 'beta',
        {name: 'old', enabled: false}]},
      extras: {enabled: false, repos: ['gamma']}
    }}));
  });

  it('lists repos with selection', async () => {
    let result = await run(['list', '--names'], {cwd: ws});
    expect(result.stdout).toBe('alpha\nbeta\n');
    result = await run(['list', '--names', '--all'], {cwd: ws});
    expect(result.stdout).toBe('alpha\nbeta\nold\ngamma\n');
    result = await run(['list', '--names', 'b*'], {cwd: ws});
    expect(result.stdout).toBe('beta\n');
    result = await run(['list', '--names', '-g', 'extras'], {cwd: ws});
    expect(result.stdout).toBe('gamma\n');
    expect(result.stderr).toMatch(/disabled group "extras"/);
    result = await run(['list', 'nope'], {cwd: ws});
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Unknown repo "nope"/);
  });

  it('selects repos by checkout state', async () => {
    await run(['clone', 'alpha'], {cwd: ws});
    let result = await run(['list', '--names', '--cloned'], {cwd: ws});
    expect(result.stdout).toBe('alpha\n');
    result = await run(['list', '--names', '--missing'], {cwd: ws});
    expect(result.stdout).toBe('beta\n');
    result = await run(['list', '--names', '--dirty'], {cwd: ws});
    expect(result.stdout).toBe('');

    await writeFiles(path.join(ws, 'alpha'), {'untracked.txt': 'x'});
    result = await run(['list', '--names', '--dirty'], {cwd: ws});
    expect(result.stdout).toBe('alpha\n');
    await fs.rm(path.join(ws, 'alpha', 'untracked.txt'));
    await fs.appendFile(path.join(ws, 'alpha', 'README.md'), 'x\n');
    result = await run(['exec', '--prefix', '--dirty', '--', 'git', 'diff',
      '--name-only'], {cwd: ws});
    expect(result.stdout).toBe('alpha: README.md\n1 repo: 1 ok\n');

    result = await run(['list', '--missing', '--dirty'], {cwd: ws});
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/cannot be used with option '--dirty'/);
  });

  it('clones missing repos, honoring dry run', async () => {
    let result = await run(['-n', 'clone'], {cwd: ws});
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/would run: git clone -- .*alpha alpha/);
    expect(await exists(path.join(ws, 'alpha'))).toBe(false);

    result = await run(['clone'], {cwd: ws});
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/2 repos: 2 cloned, 0 already present/);
    expect(await exists(path.join(ws, 'alpha', '.git'))).toBe(true);
    expect(await exists(path.join(ws, 'old'))).toBe(false);

    result = await run(['clone'], {cwd: ws});
    expect(result.stdout).toMatch(/0 cloned, 2 already present/);
  });

  it('fails clone into a non-git directory', async () => {
    await fs.mkdir(path.join(ws, 'alpha'));
    const result = await run(['clone'], {cwd: ws});
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/alpha: "alpha" exists but is not a git/);
  });

  it('shows status of interesting repos', async () => {
    await run(['clone'], {cwd: ws});
    let result = await run(['status'], {cwd: ws});
    expect(result.stdout).toBe('2 repos: 2 clean\n');

    await fs.appendFile(path.join(ws, 'alpha', 'README.md'), 'x\n');
    await fs.writeFile(path.join(ws, 'beta', 'new.txt'), 'x\n');
    await git(path.join(ws, 'beta'), 'checkout', '-q', '-b', 'feature');
    result = await run(['status'], {cwd: ws});
    expect(result.stdout.split('\n').map(l => l.trimEnd())).toEqual([
      'REPO   BRANCH   SYNC         CHANGES',
      'alpha  main                  M1',
      'beta   feature  no upstream  ?1',
      '2 repos: 0 clean, 2 changed',
      ''
    ]);

    result = await run(['--json', 'status', 'alpha', 'old'], {cwd: ws});
    const json = JSON.parse(result.stdout);
    expect(json.results.map(r => [r.repo.name, r.status])).toEqual(
      [['alpha', 'ok'], ['old', 'skipped']]);
    expect(json.results[0].data).toMatchObject({
      branch: 'main', defaultBranch: 'main', modified: 1, interesting: true
    });
    expect(json.results[1].reason).toBe('missing');
  });

  it('pulls fast-forward only and skips or fails problem repos', async () => {
    await run(['clone'], {cwd: ws});
    await pushCommit(remotes, 'alpha', {'a.txt': 'a\n'});
    await pushCommit(remotes, 'beta', {'b.txt': 'b\n'});
    // beta: local commit so it diverges
    await writeFiles(path.join(ws, 'beta'), {'local.txt': 'l\n'});
    await git(path.join(ws, 'beta'), 'add', '.');
    await git(path.join(ws, 'beta'), 'commit', '-q', '-m', 'local');

    let result = await run(['-n', 'pull'], {cwd: ws});
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/would run: git pull --ff-only/);
    expect(await exists(path.join(ws, 'alpha', 'a.txt'))).toBe(false);

    result = await run(['pull'], {cwd: ws});
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/alpha {2}1 new commit \(main\)/);
    expect(result.stdout).toMatch(/1 updated, 0 up to date, 1 failed/);
    expect(result.stdout).toMatch(/Failed:\n {2}beta: `git pull --ff-only`/);
    expect(await exists(path.join(ws, 'alpha', 'a.txt'))).toBe(true);

    await fs.appendFile(path.join(ws, 'alpha', 'README.md'), 'x\n');
    result = await run(['pull', 'alpha'], {cwd: ws});
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/alpha {2}skipped: uncommitted changes/);

    result = await run(['pull', '--rebase', 'beta'], {cwd: ws});
    expect(result.code).toBe(0);
    expect(await exists(path.join(ws, 'beta', 'b.txt'))).toBe(true);
    expect(await exists(path.join(ws, 'beta', 'local.txt'))).toBe(true);
  });

  it('greps across repos with path prefixes and grep exit codes', async () => {
    await run(['clone'], {cwd: ws});
    let result = await run(['grep', '-n', 'const name'], {cwd: ws});
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      'alpha/lib/index.js:1:export const name = \'alpha\';\n' +
      'beta/lib/index.js:1:export const name = \'beta\';\n');

    // paths relative to the current directory
    result = await run(['grep', 'const name'], {cwd: path.join(ws, 'beta')});
    expect(result.stdout).toBe(
      '../alpha/lib/index.js:export const name = \'alpha\';\n' +
      'lib/index.js:export const name = \'beta\';\n');

    // mpm options first, then git grep args with spaces kept intact
    result = await run(['grep', '-r', 'beta', '-l', 'name = \'beta\''],
      {cwd: ws});
    expect(result.stdout).toBe('beta/lib/index.js\n');

    result = await run(['grep', 'no such text'], {cwd: ws});
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');

    result = await run(['grep', '--bogus'], {cwd: ws});
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/alpha: `git grep --bogus` exited with code/);
  });

  it('runs commands with exec', async () => {
    await run(['clone'], {cwd: ws});
    let result = await run(
      ['exec', '--prefix', '--', 'sh', '-c', 'echo $MPM_REPO $MPM_GROUP'],
      {cwd: ws});
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      'alpha: alpha core\nbeta: beta core\n2 repos: 2 ok\n');

    result = await run(['exec', '-n', 'touch', 'marker'], {cwd: ws});
    expect(result.stdout).toMatch(/would run: touch marker/);
    expect(await exists(path.join(ws, 'alpha', 'marker'))).toBe(false);

    result = await run(['exec', '-n', '--read-only', 'ls'], {cwd: ws});
    expect(result.stdout).toMatch(/=== alpha\nREADME.md\nlib/);

    result = await run(['exec', 'sh', '-c', 'exit 3'], {cwd: ws});
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/exited with code 3/);

    result = await run(['--fail-fast', '-j', '1', 'exec', 'false'],
      {cwd: ws});
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/0 ok, 1 skipped, 1 failed/);
  });

  it('emits ndjson events', async () => {
    const result = await run(['--output', 'ndjson', 'clone'], {cwd: ws});
    const events = result.stdout.trim().split('\n').map(l => JSON.parse(l));
    expect(events[0]).toMatchObject({event: 'begin', command: 'clone',
      total: 2});
    expect(events.filter(e => e.event === 'repo')).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({event: 'end', ok: true,
      summary: {total: 2, ok: 2, skipped: 0, failed: 0}});
  });
});
