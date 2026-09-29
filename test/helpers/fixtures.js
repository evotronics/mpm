/**
 * Test fixtures: temporary workspaces backed by local bare "remote" repos.
 */
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import {main} from '../../lib/cli/index.js';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {Writable} from 'node:stream';

const execFileAsync = promisify(execFile);

/**
 * Run git.
 *
 * @param {string} cwd - Directory.
 * @param {...string} args - Arguments.
 *
 * @returns {Promise<string>} Stdout.
 */
export async function git(cwd, ...args) {
  const {stdout} = await execFileAsync('git', args, {cwd});
  return stdout;
}

const tempDirs = [];

/**
 * Create a temporary directory, removed by `removeTempDirs()`.
 *
 * @returns {Promise<string>} Path.
 */
export async function tempDir() {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'mpm-test-')));
  tempDirs.push(dir);
  return dir;
}

/**
 * Remove temporary directories created by this test file.
 */
export async function removeTempDirs() {
  await Promise.all(tempDirs.splice(0).map(
    dir => fs.rm(dir, {recursive: true, force: true})));
}

/**
 * Create a bare remote repo with one commit.
 *
 * @param {string} dir - Directory for remotes.
 * @param {string} name - Repo name.
 * @param {object} [files] - Files to commit.
 *
 * @returns {Promise<string>} Bare repo path.
 */
export async function createRemote(dir, name, files = {
  'README.md': `# ${name}\n`,
  'lib/index.js': `export const name = '${name}';\n`
}) {
  const bare = path.join(dir, `${name}.git`);
  await git(dir, 'init', '--bare', '--initial-branch=main', bare);
  const work = path.join(dir, `${name}.work`);
  await git(dir, 'clone', bare, work);
  await writeFiles(work, files);
  await git(work, 'add', '.');
  await git(work, 'commit', '-m', 'Initial commit.');
  await git(work, 'push', 'origin', 'main');
  return bare;
}

/**
 * Add a commit to a remote.
 *
 * @param {string} remotesDir - Remotes directory.
 * @param {string} name - Repo name.
 * @param {object} files - Files to write.
 */
export async function pushCommit(remotesDir, name, files) {
  const work = path.join(remotesDir, `${name}.work`);
  await writeFiles(work, files);
  await git(work, 'add', '.');
  await git(work, 'commit', '-m', 'Update.');
  await git(work, 'push', 'origin', 'main');
}

/**
 * Write files under a directory.
 *
 * @param {string} dir - Base directory.
 * @param {object} files - Map of relative path to content.
 */
export async function writeFiles(dir, files) {
  for(const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file);
    await fs.mkdir(path.dirname(full), {recursive: true});
    await fs.writeFile(full, content);
  }
}

/**
 * Create a workspace with groups of repos backed by local remotes.
 *
 * @param {object} options - Options.
 * @param {object} options.groups - Map of group id to group config; string
 *   repo entries also get a remote created.
 * @param {object} [options.settings] - Workspace settings.
 * @param {object} [options.files] - Map of repo name to files for its
 *   remote's initial commit.
 *
 * @returns {Promise<{root: string, ws: string, remotes: string}>} Paths.
 */
export async function createWorkspace({groups, settings = {}, files = {}}) {
  const root = await tempDir();
  const remotes = path.join(root, 'remotes');
  const ws = path.join(root, 'ws');
  await fs.mkdir(remotes);
  await fs.mkdir(path.join(ws, 'mpm.d'), {recursive: true});
  const lines = ['version: 1', 'settings:', '  jobs: 4'];
  for(const [key, value] of Object.entries(settings)) {
    lines.push(`  ${key}: ${value}`);
  }
  await fs.writeFile(path.join(ws, 'mpm.yaml'), lines.join('\n') + '\n');
  for(const [id, group] of Object.entries(groups)) {
    for(const entry of group.repos ?? []) {
      const name = typeof entry === 'string' ? entry : entry.name;
      if(!await fs.access(path.join(remotes, `${name}.git`)).then(
        () => true, () => false)) {
        await createRemote(remotes, name, files[name]);
      }
    }
    const config = {source: remotes, ...group};
    await fs.writeFile(path.join(ws, 'mpm.d', `${id}.yaml`),
      JSON.stringify(config, null, 2));
  }
  return {root, ws, remotes};
}

/**
 * Run the CLI in-process and capture output.
 *
 * @param {string[]} argv - Arguments.
 * @param {object} [options] - Options.
 * @param {string} [options.cwd] - Current directory.
 * @param {object} [options.env] - Extra environment.
 *
 * @returns {Promise<{code: number, stdout: string, stderr: string}>} Result.
 */
export async function run(argv, {cwd, env = {}} = {}) {
  const stdout = capture();
  const stderr = capture();
  const code = await main(argv, {
    stdout,
    stderr,
    cwd,
    env: {...process.env, NO_COLOR: '1', ...env}
  });
  return {code, stdout: stdout.text(), stderr: stderr.text()};
}

function capture() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(chunk);
      callback();
    }
  });
  stream.text = () => Buffer.concat(chunks).toString();
  return stream;
}
