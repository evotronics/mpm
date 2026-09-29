/**
 * Shared output for commands that edit config files.
 */
import {ConfigEditor} from '../config/editor.js';

/**
 * Run an edit and commit it.
 *
 * @param {object} options - Options.
 * @param {object} options.workspace - Workspace.
 * @param {boolean} options.dryRun - Dry run.
 * @param {Function} options.edit - `async (editor, messages) => void`.
 *
 * @returns {Promise<object>} Command output with `data` (`messages`,
 *   `changes`) and `context` (`workspace` after the edit).
 */
export async function applyEdit({workspace, dryRun, edit}) {
  const editor = new ConfigEditor({root: workspace.root});
  const messages = [];
  await edit(editor, messages);
  const {changes, workspace: updated} = await editor.commit({dryRun});
  return {
    data: {messages, changes},
    context: {workspace: updated}
  };
}

/**
 * Format edit results: messages, then per-file lines with diffs in dry run
 * or verbose mode.
 *
 * @param {object} data - Edit data.
 * @param {string[]} data.messages - Messages describing the edits.
 * @param {object[]} data.changes - File changes from `ConfigEditor`.
 * @param {object} context - Format context.
 * @param {object} context.c - Colors.
 * @param {boolean} context.dryRun - Dry run.
 * @param {boolean} context.verbose - Verbose.
 * @param {boolean} context.quiet - Quiet.
 *
 * @returns {string} Text.
 */
export function editText({messages, changes}, {c, dryRun, verbose, quiet}) {
  const lines = quiet ? [] : [...messages];
  if(changes.length === 0) {
    if(!quiet) {
      lines.push(c.dim('No config changes.'));
    }
    return lines.join('\n');
  }
  for(const change of changes) {
    const verb = {
      create: dryRun ? 'would create' : 'created',
      update: dryRun ? 'would update' : 'updated',
      delete: dryRun ? 'would delete' : 'deleted'
    }[change.action];
    if(!quiet) {
      lines.push(`${dryRun ? c.cyan(verb) : verb} ${change.path}`);
    }
    if(dryRun || verbose) {
      lines.push(colorDiff(change.diff, c));
    }
  }
  return lines.join('\n');
}

/**
 * Standard text formatter for edit-only commands.
 */
export const editCommandText = {
  end({data}, context) {
    return editText(data, context);
  }
};

function colorDiff(diff, c) {
  return diff.replace(/\n$/, '').split('\n').map(line => {
    if(line.startsWith('+++') || line.startsWith('---')) {
      return c.bold(line);
    }
    if(line.startsWith('@@')) {
      return c.cyan(line);
    }
    if(line.startsWith('+')) {
      return c.green(line);
    }
    if(line.startsWith('-')) {
      return c.red(line);
    }
    return line;
  }).join('\n');
}
