/**
 * Text formatting helpers shared by commands.
 */
import {formatCommand} from '../run/exec.js';
import picocolors from 'picocolors';
import {stripVTControlCharacters} from 'node:util';

/**
 * Create color functions.
 *
 * @param {boolean} enabled - Enable color.
 *
 * @returns {object} Picocolors style functions.
 */
export function createColors(enabled) {
  return picocolors.createColors(enabled);
}

/**
 * Decide whether to use color.
 *
 * @param {object} options - Options.
 * @param {boolean} [options.color] - Explicit --color / --no-color.
 * @param {object} options.stream - Output stream.
 * @param {object} options.env - Environment.
 *
 * @returns {boolean} True to use color.
 */
export function shouldUseColor({color, stream, env}) {
  if(color !== undefined) {
    return color;
  }
  if('NO_COLOR' in env && env.NO_COLOR !== '') {
    return false;
  }
  if('FORCE_COLOR' in env) {
    return env.FORCE_COLOR !== '0' && env.FORCE_COLOR !== 'false';
  }
  return Boolean(stream.isTTY) && env.TERM !== 'dumb';
}

/**
 * Visible width of a string (ignoring ANSI escapes).
 *
 * @param {string} value - String.
 *
 * @returns {number} Width.
 */
export function width(value) {
  return stripVTControlCharacters(value).length;
}

/**
 * Format rows as aligned columns.
 *
 * @param {string[][]} rows - Rows of cells (may contain ANSI escapes).
 * @param {object} [options] - Options.
 * @param {string} [options.gap] - Column separator.
 *
 * @returns {string} Table text (no trailing newline).
 */
export function formatTable(rows, {gap = '  '} = {}) {
  const widths = [];
  for(const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, width(cell));
    });
  }
  return rows.map(row => row.map((cell, i) => i === row.length - 1 ?
    cell : cell + ' '.repeat(widths[i] - width(cell))).join(gap).trimEnd())
    .join('\n');
}

/**
 * Status marker for a result.
 *
 * @param {object} result - Repo result.
 * @param {object} c - Colors.
 *
 * @returns {string} Marker.
 */
export function statusMark(result, c) {
  switch(result.status) {
    case 'ok':
      return c.green('✓');
    case 'skipped':
      return c.yellow('-');
    default:
      return c.red('✗');
  }
}

/**
 * Lines describing actions run (verbose) or that would be run (dry run).
 *
 * @param {object} result - Repo result.
 * @param {object} context - Format context.
 * @param {object} context.c - Colors.
 * @param {boolean} context.verbose - Verbose.
 * @param {string} [indent] - Line prefix.
 *
 * @returns {string[]} Lines.
 */
export function actionLines(result, {c, verbose}, indent = '  ') {
  const lines = [];
  for(const action of result.actions ?? []) {
    const text = formatCommand(action.cmd, action.args);
    if(action.dryRun) {
      lines.push(`${indent}${c.cyan('would run:')} ${text}`);
    } else if(verbose) {
      lines.push(`${indent}${c.dim('$ ' + text)}`);
    }
  }
  return lines;
}

/**
 * Lines describing a failure: the reason plus the tail of stderr.
 *
 * @param {object} result - Repo result.
 * @param {object} context - Format context.
 * @param {object} context.c - Colors.
 * @param {boolean} context.verbose - Show all output.
 * @param {string} [indent] - Line prefix.
 *
 * @returns {string[]} Lines.
 */
export function errorLines(result, {c, verbose}, indent = '  ') {
  if(result.status !== 'failed') {
    return [];
  }
  const lines = [];
  const output = result.error?.result?.output?.trim();
  if(output) {
    const outputLines = output.split('\n');
    const shown = verbose ? outputLines : outputLines.slice(-10);
    if(shown.length < outputLines.length) {
      lines.push(`${indent}${c.dim('…')}`);
    }
    lines.push(...shown.map(line => `${indent}${c.dim(line)}`));
  } else if(result.reason) {
    lines.push(`${indent}${c.red(result.reason)}`);
  }
  return lines;
}

/**
 * Count results by status.
 *
 * @param {object[]} results - Repo results.
 *
 * @returns {{total: number, ok: number, skipped: number, failed: number}}
 *   Counts.
 */
export function summarize(results = []) {
  const summary = {total: results.length, ok: 0, skipped: 0, failed: 0};
  for(const result of results) {
    summary[result.status]++;
  }
  return summary;
}

/**
 * Default summary text: counts line and a list of failures.
 *
 * @param {object} report - Command report.
 * @param {object} context - Format context.
 * @param {object} context.c - Colors.
 * @param {object} [options] - Options.
 * @param {string[]} [options.parts] - Count phrases for ok results (default
 *   "N ok"); skipped and failed counts are appended.
 * @param {number} [options.skipped] - Skipped count to show (default from
 *   the summary).
 *
 * @returns {string} Summary text.
 */
export function summaryText(report, {c}, {
  parts: okParts, skipped = report.summary.skipped
} = {}) {
  const {summary} = report;
  const parts = okParts ?? [`${summary.ok} ok`];
  if(skipped > 0) {
    parts.push(c.yellow(`${skipped} skipped`));
  }
  if(summary.failed > 0) {
    parts.push(c.red(`${summary.failed} failed`));
  }
  const noun = summary.total === 1 ? 'repo' : 'repos';
  const lines = [
    `${report.dryRun ? c.cyan('(dry run) ') : ''}` +
    `${summary.total} ${noun}: ${parts.join(', ')}`
  ];
  const failures = report.results.filter(r => r.status === 'failed');
  if(failures.length > 0 && report.results.length > 1) {
    lines.push(c.red('Failed:'));
    for(const result of failures) {
      lines.push(`  ${result.repo.name}: ${result.reason}`);
    }
  }
  return lines.join('\n');
}
