/**
 * Isolate tests from the user's git and mpm configuration.
 */
import {afterAll} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {removeTempDirs} from './fixtures.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpm-gitconfig-'));
const config = path.join(dir, 'gitconfig');
fs.writeFileSync(config, `[user]
  name = mpm test
  email = mpm-test@example.com
[init]
  defaultBranch = main
[advice]
  detachedHead = false
`);
process.env.GIT_CONFIG_GLOBAL = config;
process.env.GIT_CONFIG_NOSYSTEM = '1';
delete process.env.MPM_WORKSPACE;
delete process.env.MPM_PROTOCOL;
delete process.env.MPM_USER_CONFIG;
// never read the developer's own ~/.config/mpm
process.env.XDG_CONFIG_HOME = path.join(dir, 'config');

afterAll(async () => {
  await removeTempDirs();
  fs.rmSync(dir, {recursive: true, force: true});
});
