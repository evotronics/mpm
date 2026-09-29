/**
 * Error types and process exit codes.
 */

export const EXIT = Object.freeze({
  OK: 0,
  // some repos failed, or (for grep) nothing matched
  FAILED: 1,
  // bad usage, bad config, no workspace
  USAGE: 2,
  // interrupted by SIGINT
  INTERRUPTED: 130
});

export class MpmError extends Error {
  /**
   * @param {string} message - Error message.
   * @param {object} [options] - Options.
   * @param {string} [options.code] - Machine readable code.
   * @param {number} [options.exitCode] - Process exit code.
   * @param {string[]} [options.details] - Extra detail lines.
   * @param {Error} [options.cause] - Underlying error.
   */
  constructor(message, {
    code = 'MPM_ERROR', exitCode = EXIT.USAGE, details = [], cause
  } = {}) {
    super(message, {cause});
    this.name = 'MpmError';
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export class ConfigError extends MpmError {
  constructor(message, options = {}) {
    super(message, {code: 'CONFIG_ERROR', ...options});
    this.name = 'ConfigError';
  }
}

export class UsageError extends MpmError {
  constructor(message, options = {}) {
    super(message, {code: 'USAGE_ERROR', ...options});
    this.name = 'UsageError';
  }
}

export class ExecError extends MpmError {
  /**
   * @param {string} message - Error message.
   * @param {object} options - Options.
   * @param {object} options.result - The exec result.
   */
  constructor(message, {result, ...options}) {
    super(message, {code: 'EXEC_ERROR', exitCode: EXIT.FAILED, ...options});
    this.name = 'ExecError';
    this.result = result;
  }
}
