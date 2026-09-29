/**
 * Child process execution. Commands are always spawned with an argv array
 * (never through a shell unless explicitly requested) so arguments keep
 * their quoting.
 */
import {ExecError} from '../errors.js';
import {spawn} from 'node:child_process';

/**
 * @typedef {object} ExecResult
 * @property {number|null} code - Exit code.
 * @property {string|null} signal - Terminating signal.
 * @property {string} stdout - Captured stdout.
 * @property {string} stderr - Captured stderr.
 * @property {string} output - Captured stdout and stderr in arrival order.
 * @property {boolean} [dryRun] - True if the command was not run.
 */

/**
 * Spawn a process and wait for it to exit.
 *
 * @param {string} cmd - Command.
 * @param {string[]} args - Arguments.
 * @param {object} [options] - Options.
 * @param {string} [options.cwd] - Working directory.
 * @param {object} [options.env] - Full environment.
 * @param {AbortSignal} [options.signal] - Abort signal; kills the child.
 * @param {boolean} [options.interactive] - Inherit stdio instead of
 *   capturing.
 *
 * @returns {Promise<ExecResult>} Result.
 */
export function spawnProcess(cmd, args, {
  cwd, env = process.env, signal, interactive = false
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      signal
    });
    const stdout = [];
    const stderr = [];
    const output = [];
    child.stdout?.on('data', chunk => {
      stdout.push(chunk);
      output.push(chunk);
    });
    child.stderr?.on('data', chunk => {
      stderr.push(chunk);
      output.push(chunk);
    });
    child.on('error', error => {
      if(error.code === 'ENOENT') {
        reject(new ExecError(`Command not found: ${cmd}`, {
          result: {code: null, signal: null, stdout: '', stderr: '',
            output: ''},
          cause: error
        }));
        return;
      }
      reject(error);
    });
    child.on('close', (code, exitSignal) => {
      resolve({
        code,
        signal: exitSignal,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
        output: Buffer.concat(output).toString()
      });
    });
  });
}

/**
 * Format a command for display, quoting arguments when needed.
 *
 * @param {string} cmd - Command.
 * @param {string[]} args - Arguments.
 *
 * @returns {string} Display string.
 */
export function formatCommand(cmd, args = []) {
  return [cmd, ...args].map(quote).join(' ');
}

function quote(value) {
  if(value === '') {
    return '\'\'';
  }
  if(/^[\w@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, '\'\\\'\'')}'`;
}
