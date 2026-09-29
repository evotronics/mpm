/**
 * Output renderers. Commands produce structured results; renderers turn the
 * event stream (`begin`, `repoStart`, `repoDone`, `end`) into text, JSON, or
 * NDJSON. A TUI would be another renderer.
 */
import {ProgressLine} from './progress.js';
import {summaryText} from './format.js';

export const JSON_SCHEMA_VERSION = 1;
export const OUTPUT_FORMATS = ['text', 'json', 'ndjson'];

class TextRenderer {
  constructor({command, io, c, verbose, quiet, dryRun, progress, options,
    args, cwd}) {
    this.command = command;
    this.io = io;
    this.context = {c, verbose, quiet, dryRun, options, args, cwd};
    this.useProgress = progress;
    this.progress = null;
    this.pending = new Map();
    this.next = 0;
  }

  notice(message) {
    if(!this.context.quiet) {
      this.err(`${this.context.c.yellow('mpm:')} ${message}\n`);
    }
  }

  begin({total}) {
    if(this.useProgress && total > 1) {
      this.progress = new ProgressLine({
        stream: this.io.stderr,
        label: this.command.name,
        total,
        c: this.context.c
      });
    }
  }

  repoStart(index, repo) {
    this.progress?.start(index, repo.name);
  }

  repoDone(index, result) {
    this.progress?.finish(index);
    this.pending.set(index, result);
    // flush in repo order
    while(this.pending.has(this.next)) {
      const next = this.pending.get(this.next);
      this.pending.delete(this.next);
      this.next++;
      const text = this.command.text?.repo?.(next, this.context);
      if(text) {
        this.out(text.endsWith('\n') ? text : text + '\n');
      }
    }
  }

  end(report) {
    this.progress?.stop();
    this.progress = null;
    // formatters decide what quiet mode hides; the default summary is
    // hidden in quiet mode unless something failed
    const end = this.command.text?.end ??
      (report.results ? r => this.context.quiet && r.exitCode === 0 ?
        undefined : summaryText(r, this.context) : undefined);
    let text = end?.(report, this.context);
    if(!text) {
      return;
    }
    if(typeof text === 'string') {
      text = {out: text};
    }
    if(text.out) {
      this.out(text.out.endsWith('\n') ? text.out : text.out + '\n');
    }
    if(text.err) {
      this.err(text.err.endsWith('\n') ? text.err : text.err + '\n');
    }
  }

  out(text) {
    if(this.progress) {
      this.progress.write(this.io.stdout, text);
    } else {
      this.io.stdout.write(text);
    }
  }

  err(text) {
    if(this.progress) {
      this.progress.write(this.io.stderr, text);
    } else {
      this.io.stderr.write(text);
    }
  }
}

class JsonRenderer {
  constructor({command, io, dryRun}) {
    this.command = command;
    this.io = io;
    this.dryRun = dryRun;
    this.notices = [];
  }

  notice(message) {
    this.notices.push(message);
  }

  begin() {}
  repoStart() {}
  repoDone() {}

  end(report) {
    const output = {
      schemaVersion: JSON_SCHEMA_VERSION,
      ...serializeReport(report, this.command),
      notices: [...this.notices, ...report.notices ?? []]
    };
    this.io.stdout.write(JSON.stringify(output, null, 2) + '\n');
  }
}

class NdjsonRenderer {
  constructor({command, io, dryRun}) {
    this.command = command;
    this.io = io;
    this.dryRun = dryRun;
  }

  write(event) {
    this.io.stdout.write(JSON.stringify(event) + '\n');
  }

  notice(message) {
    this.write({event: 'notice', message});
  }

  begin({total}) {
    this.write({
      event: 'begin', schemaVersion: JSON_SCHEMA_VERSION,
      command: this.command.name, dryRun: this.dryRun, total
    });
  }

  repoStart() {}

  repoDone(index, result) {
    this.write({
      event: 'repo', index, ...serializeResult(result, this.command)
    });
  }

  end(report) {
    // results were already streamed as `repo` events
    // eslint-disable-next-line no-unused-vars
    const {results, ...rest} = serializeReport(report, this.command);
    this.write({event: 'end', ...rest});
  }
}

/**
 * Create a renderer.
 *
 * @param {object} options - Options.
 * @param {'text'|'json'|'ndjson'} options.format - Output format.
 * @param {object} options.command - Command definition.
 * @param {object} options.io - `{stdout, stderr}` streams.
 * @param {object} options.c - Colors.
 * @param {boolean} options.verbose - Verbose.
 * @param {boolean} options.quiet - Quiet.
 * @param {boolean} options.dryRun - Dry run.
 * @param {boolean} options.progress - Show a progress line (text only).
 * @param {object} options.options - Command options, for formatters.
 * @param {string[]} options.args - Command arguments, for formatters.
 * @param {string} options.cwd - Current directory, for formatters.
 *
 * @returns {object} Renderer.
 */
export function createRenderer({format, ...options}) {
  switch(format) {
    case 'json':
      return new JsonRenderer(options);
    case 'ndjson':
      return new NdjsonRenderer(options);
    default:
      return new TextRenderer(options);
  }
}

/**
 * Serialize a command report for JSON output.
 *
 * @param {object} report - Report.
 * @param {object} command - Command definition.
 *
 * @returns {object} JSON-safe object.
 */
export function serializeReport(report, command) {
  const output = {
    command: report.command,
    ok: report.exitCode === 0,
    exitCode: report.exitCode,
    dryRun: report.dryRun
  };
  if(report.summary) {
    output.summary = report.summary;
  }
  if(report.data !== undefined) {
    output.data = report.data;
  }
  if(report.results) {
    output.results = report.results.map(r => serializeResult(r, command));
  }
  return output;
}

/**
 * Serialize a repo result for JSON output.
 *
 * @param {object} result - Repo result.
 * @param {object} command - Command definition.
 *
 * @returns {object} JSON-safe object.
 */
export function serializeResult(result, command) {
  const {repo} = result;
  const output = {
    repo: {name: repo.name, group: repo.group, path: repo.relPath},
    status: result.status
  };
  if(result.reason !== undefined) {
    output.reason = result.reason;
  }
  const data = command.json?.repo ?
    command.json.repo(result) : result.data;
  if(data !== undefined) {
    output.data = data;
  }
  if(result.error) {
    output.error = {
      message: result.error.message,
      code: result.error.code
    };
    const stderr = result.error.result?.stderr;
    if(stderr) {
      output.error.stderr = stderr;
    }
  }
  if(result.actions?.length > 0) {
    output.actions = result.actions.map(a => a.label ? {
      label: a.label,
      ...(a.dryRun ? {dryRun: true} : {})
    } : {
      cmd: a.cmd,
      args: a.args,
      ...(a.dryRun ? {dryRun: true} : {exitCode: a.exitCode})
    });
  }
  if(result.durationMs !== undefined) {
    output.durationMs = result.durationMs;
  }
  return output;
}
