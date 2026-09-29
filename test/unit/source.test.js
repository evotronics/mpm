import {describe, expect, it} from 'vitest';
import {isFullRef, refToName, resolveRepoUrl} from '../../lib/repos/source.js';

const root = '/ws';

function resolve(ref, source, protocol = 'ssh') {
  return resolveRepoUrl({ref, source, protocol, root});
}

describe('resolveRepoUrl', () => {
  it('resolves names against host shorthand sources', () => {
    expect(resolve('widget', 'github:example-org'))
      .toBe('git@github.com:example-org/widget.git');
    expect(resolve('widget', 'github:example-org', 'https'))
      .toBe('https://github.com/example-org/widget.git');
    expect(resolve('x', 'gitlab:group/sub'))
      .toBe('git@gitlab.com:group/sub/x.git');
  });

  it('keeps dots in repo names', () => {
    expect(resolve('parser.js', 'github:example-org'))
      .toBe('git@github.com:example-org/parser.js.git');
  });

  it('resolves names against scp-like and URL sources', () => {
    expect(resolve('a', 'git@github.com:org')).toBe('git@github.com:org/a.git');
    expect(resolve('a', 'https://example.com/git/org/'))
      .toBe('https://example.com/git/org/a.git');
    expect(resolve('a', 'ssh://git@example.com:2222/org'))
      .toBe('ssh://git@example.com:2222/org/a.git');
  });

  it('resolves owner/name as a sibling of the source owner', () => {
    expect(resolve('other/a', 'github:org'))
      .toBe('git@github.com:other/a.git');
    expect(resolve('other/a', 'https://example.com/git/org'))
      .toBe('https://example.com/git/other/a.git');
    expect(resolve('other/a', '/srv/git/org')).toBe('/srv/git/other/a');
  });

  it('resolves local directory sources without adding .git', () => {
    expect(resolve('a', '/srv/git')).toBe('/srv/git/a');
    expect(resolve('a', './remotes')).toBe('/ws/remotes/a');
  });

  it('uses full references as is', () => {
    expect(resolve('https://gitlab.com/x/y.git', 'github:org'))
      .toBe('https://gitlab.com/x/y.git');
    expect(resolve('git@example.com:x/y.git')).toBe('git@example.com:x/y.git');
    expect(resolve('github:x/y', undefined, 'https'))
      .toBe('https://github.com/x/y');
    expect(resolve('/abs/path/y')).toBe('/abs/path/y');
  });

  it('returns undefined for names without a source', () => {
    expect(resolve('a')).toBe(undefined);
  });
});

describe('refToName', () => {
  it('derives names', () => {
    expect(refToName('widget')).toBe('widget');
    expect(refToName('owner/widget')).toBe('widget');
    expect(refToName('https://gitlab.com/x/y.git')).toBe('y');
    expect(refToName('git@github.com:x/parser.js.git')).toBe('parser.js');
    expect(refToName('github:x/y/')).toBe('y');
  });
});

describe('isFullRef', () => {
  it('classifies references', () => {
    expect(isFullRef('name')).toBe(false);
    expect(isFullRef('owner/name')).toBe(false);
    expect(isFullRef('github:owner/name')).toBe(true);
    expect(isFullRef('git@host:x')).toBe(true);
    expect(isFullRef('https://host/x')).toBe(true);
    expect(isFullRef('./x')).toBe(true);
  });
});
