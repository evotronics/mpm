/**
 * Isolate tests from the user's git configuration.
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

afterAll(async () => {
  await removeTempDirs();
  fs.rmSync(dir, {recursive: true, force: true});
});
