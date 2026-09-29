import {describe, expect, it} from 'vitest';
import {globToRegExp, parseTagExpression, selectRepos}
  from '../../lib/repos/select.js';

function repo(name, group, {enabled = true, groupEnabled = true, tags = []}
  = {}) {
  return {
    name, group, path: `/ws/${name}`, relPath: name,
    enabled: enabled && groupEnabled, repoEnabled: enabled, groupEnabled, tags
  };
}

const repos = [
  repo('widget', 'core', {tags: ['core', 'server']}),
  repo('widget-web', 'core', {tags: ['core', 'web']}),
  repo('widget-old', 'core', {enabled: false, tags: ['core', 'archived']}),
  repo('tool-cli', 'apps', {tags: ['apps']}),
  repo('sample-data', 'extras', {groupEnabled: false})
].map((r, index) => ({...r, index}));

const workspace = {
  groups: [
    {id: 'extras', enabled: false},
    {id: 'core', enabled: true},
    {id: 'apps', enabled: true}
  ],
  repos
};

async function names(selection, options) {
  const {repos: selected} = await selectRepos(workspace, selection, options);
  return selected.map(r => r.name);
}

describe('selectRepos', () => {
  it('selects enabled repos by default', async () => {
    expect(await names({}))
      .toEqual(['widget', 'widget-web', 'tool-cli']);
  });

  it('includes disabled repos with all', async () => {
    expect(await names({all: true})).toHaveLength(5);
  });

  it('selects by group, including a named disabled group', async () => {
    expect(await names({groups: ['apps']})).toEqual(['tool-cli']);
    const {repos: selected, notices} = await selectRepos(workspace,
      {groups: ['extras']});
    expect(selected.map(r => r.name)).toEqual(['sample-data']);
    expect(notices[0]).toMatch(/disabled group "extras"/);
  });

  it('accepts comma separated values', async () => {
    expect(await names({groups: ['apps,core']}))
      .toEqual(['widget', 'widget-web', 'tool-cli']);
  });

  it('selects by glob and exact name', async () => {
    expect(await names({repos: ['widget*']}))
      .toEqual(['widget', 'widget-web']);
    // exact names include disabled repos
    expect(await names({repos: ['widget-old']}))
      .toEqual(['widget-old']);
  });

  it('selects by tag expressions', async () => {
    expect(await names({tags: ['web,apps']}))
      .toEqual(['widget-web', 'tool-cli']);
    expect(await names({tags: ['core+!web']})).toEqual(['widget']);
    expect(await names({tags: ['!core']})).toEqual(['tool-cli']);
    expect(await names({tags: ['server'], all: true})).toEqual(['widget']);
  });

  it('excludes and resumes', async () => {
    expect(await names({exclude: ['widget-*']}))
      .toEqual(['widget', 'tool-cli']);
    expect(await names({from: 'widget-web'}))
      .toEqual(['widget-web', 'tool-cli']);
  });

  it('resolves "." from the current directory', async () => {
    expect(await names({repos: ['.']}, {cwd: '/ws/tool-cli/lib'}))
      .toEqual(['tool-cli']);
    await expect(names({repos: ['.']}, {cwd: '/elsewhere'}))
      .rejects.toThrow(/not inside a configured repo/);
  });

  it('rejects unknown groups, repos, and empty globs', async () => {
    await expect(names({groups: ['nope']})).rejects.toThrow(/Unknown group/);
    await expect(names({repos: ['nope']})).rejects.toThrow(/Unknown repo/);
    await expect(names({repos: ['nope*']})).rejects.toThrow(/No repos match/);
    await expect(names({from: 'nope'})).rejects.toThrow(/Unknown repo/);
  });

  it('notes unknown tags', async () => {
    const {notices} = await selectRepos(workspace, {tags: ['nope']});
    expect(notices).toEqual(['Tag "nope" is not used by any repo.']);
  });
});

describe('globToRegExp', () => {
  it('converts globs', () => {
    expect(globToRegExp('a*').test('abc')).toBe(true);
    expect(globToRegExp('a?c').test('abc')).toBe(true);
    expect(globToRegExp('a.c').test('abc')).toBe(false);
    expect(globToRegExp('[ab]x').test('bx')).toBe(true);
    expect(globToRegExp('[!ab]x').test('bx')).toBe(false);
  });
});

describe('parseTagExpression', () => {
  it('parses OR of AND terms', () => {
    expect(parseTagExpression('a,b+!c')).toEqual([
      [{tag: 'a', negate: false}],
      [{tag: 'b', negate: false}, {tag: 'c', negate: true}]
    ]);
    expect(() => parseTagExpression(',')).toThrow();
    expect(() => parseTagExpression('a+!')).toThrow();
  });
});
