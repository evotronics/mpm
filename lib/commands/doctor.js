/**
 * `mpm doctor`: check the workspace for problems.
 */
import {CONFIG_FILE} from '../config/files.js';
import {EXIT} from '../errors.js';
import fs from 'node:fs/promises';
import {isCloned} from '../repos/select.js';
import path from 'node:path';
import {pathExists} from '../util/fs.js';
import {printable} from '../util/text.js';
import {urlKey} from '../repos/source.js';

const SEVERITY_ORDER = ['error', 'warning', 'info'];

export default {
  name: 'doctor',
  helpGroup: 'Workspace and config commands:',
  summary: 'Check the workspace for problems',
  description: 'Check the whole workspace:\n' +
    '- directories in the workspace that are not in the config\n' +
    '- enabled repos that are not cloned\n' +
    '- disabled repos that are still checked out\n' +
    '- configured paths that are not git checkouts\n' +
    '- origin URLs that differ from the config\n\n' +
    'Exit status is 1 if errors or warnings are found.',
  progress: true,

  async run({workspace, runRepos}) {
    const findings = [];

    // checkout directories not in the config
    const configured = new Set(workspace.repos.map(r => r.relPath));
    const entries = await fs.readdir(workspace.root, {withFileTypes: true});
    const unknown = entries.filter(e => e.isDirectory() &&
      !e.name.startsWith('.') &&
      !configured.has(e.name));
    const unknownDirs = unknown.map(e => ({
      name: e.name, relPath: e.name, path: path.join(workspace.root, e.name)
    }));

    const results = await runRepos(async (repo, context) => {
      if(repo.unknown) {
        if(!await isCloned(repo)) {
          return {finding: {
            severity: 'info', type: 'unknown-directory', path: repo.relPath,
            message: 'directory is not a configured repo'
          }};
        }
        const origin = await originUrl(context);
        return {finding: {
          severity: 'warning', type: 'unknown-repo', path: repo.relPath,
          url: origin,
          message: 'git checkout is not in the config',
          suggestion: origin ?
            `mpm repo add <group> ${origin}` : 'mpm repo add <group> <url>'
        }};
      }
      const cloned = await isCloned(repo);
      if(!cloned) {
        if(await pathExists(repo.path)) {
          return {finding: {
            severity: 'error', type: 'not-a-checkout', repo: repo.name,
            path: repo.relPath,
            message: 'path exists but is not a git checkout'
          }};
        }
        return repo.enabled ? {finding: {
          severity: 'warning', type: 'missing', repo: repo.name,
          path: repo.relPath, message: 'enabled repo is not cloned',
          suggestion: `mpm clone ${repo.name}`
        }} : {};
      }
      const found = [];
      if(!repo.enabled) {
        found.push({
          severity: 'info', type: 'disabled-checkout', repo: repo.name,
          path: repo.relPath, message: 'disabled repo is checked out',
          suggestion: `mpm repo rm --delete ${repo.name} (or enable it)`
        });
      }
      const origin = await originUrl(context);
      if(!origin) {
        found.push({
          severity: 'warning', type: 'no-origin', repo: repo.name,
          path: repo.relPath, message: 'no "origin" remote',
          suggestion: `git -C ${repo.relPath} remote add origin ${repo.url}`
        });
      } else if(origin !== repo.url) {
        const sameRepo = urlKey(origin) === urlKey(repo.url);
        found.push({
          severity: sameRepo ? 'info' : 'warning',
          type: sameRepo ? 'origin-protocol' : 'origin-mismatch',
          repo: repo.name,
          path: repo.relPath,
          url: origin,
          expected: repo.url,
          message: sameRepo ?
            `origin uses a different URL form (${origin})` :
            `origin is ${origin}, config has ${repo.url}`,
          suggestion: `git -C ${repo.relPath} remote set-url origin ${repo.url}`
        });
      }
      return {findings: found};
    }, {
      repos: [
        ...workspace.repos,
        ...unknownDirs.map(d => ({...d, unknown: true}))
      ]
    });

    for(const result of results) {
      if(result.status === 'failed') {
        findings.push({
          severity: 'error', type: 'check-failed', repo: result.repo.name,
          path: result.repo.relPath, message: result.reason
        });
        continue;
      }
      if(result.data?.finding) {
        findings.push(result.data.finding);
      }
      findings.push(...result.data?.findings ?? []);
    }
    findings.sort((a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      a.path.localeCompare(b.path));

    const problems = findings.filter(f => f.severity !== 'info').length;
    return {
      data: {
        findings,
        checked: {repos: workspace.repos.length, directories: unknown.length}
      },
      exitCode: problems > 0 ? EXIT.FAILED : EXIT.OK
    };
  },

  text: {
    end({data}, {c, quiet}) {
      const lines = [];
      const color = {error: c.red, warning: c.yellow, info: c.dim};
      // many missing repos (e.g. a new workspace) get one line
      const missing = data.findings.filter(f => f.type === 'missing');
      const collapse = missing.length > 5;
      if(collapse) {
        lines.push(`${color.warning('warning')} ${missing.length} enabled ` +
          `repos are not cloned: ${missing.slice(0, 5).map(f => f.repo)
            .join(', ')}, …`);
        lines.push(c.dim('        fix: mpm clone'));
      }
      for(const finding of data.findings) {
        if(quiet && finding.severity === 'info' ||
          collapse && finding.type === 'missing') {
          continue;
        }
        lines.push(`${color[finding.severity](finding.severity.padEnd(7))} ` +
          `${c.bold(finding.path)}: ${finding.message}`);
        if(finding.suggestion) {
          lines.push(c.dim(`        fix: ${finding.suggestion}`));
        }
      }
      const counts = {error: 0, warning: 0, info: 0};
      data.findings.forEach(f => counts[f.severity]++);
      if(data.findings.length === 0) {
        lines.push(`${c.green('✓')} no problems found in ` +
          `${data.checked.repos} repos (${CONFIG_FILE})`);
      } else if(!quiet) {
        lines.push(`${counts.error} errors, ${counts.warning} warnings, ` +
          `${counts.info} notes`);
      }
      return lines.join('\n');
    }
  }
};

async function originUrl(context) {
  const result = await context.run('git', ['remote', 'get-url', 'origin'],
    {allowExitCodes: [0, 2, 128]});
  // from git config, which mpm does not control
  return result.code === 0 ? printable(result.stdout.trim()) : null;
}
