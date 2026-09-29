#!/usr/bin/env node
/**
 * Fake GitHub CLI for tests: `gh repo list <owner> ...` prints
 * `$FAKE_GH_DIR/<owner>.json`, or fails like gh for unknown owners. Every
 * call's arguments are appended to `$FAKE_GH_DIR/calls.log`.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.FAKE_GH_DIR;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'calls.log'), args.join(' ') + '\n');
const file = path.join(dir, `${args[2]}.json`);
if(args[0] === 'repo' && args[1] === 'list' && fs.existsSync(file)) {
  process.stdout.write(fs.readFileSync(file));
} else {
  process.stderr.write('GraphQL: Could not resolve to a Repository Owner ' +
    `(${args[2]})\n`);
  process.exit(1);
}
