import {describe, expect, it} from 'vitest';
import {validateConfig} from '../../lib/config/schema.js';

describe('validateConfig', () => {
  it('accepts valid configs', () => {
    expect(validateConfig('workspace', {
      version: 1, settings: {jobs: 4, protocol: 'https', layout: 'flat'}
    })).toEqual([]);
    expect(validateConfig('group', {
      title: 'x', source: 'github:x', enabled: false, tags: ['a'],
      repos: ['a', 'o/b', {name: 'c', enabled: false, tags: ['t']},
        {url: 'https://h/x/d.git'}]
    })).toEqual([]);
  });

  it('reports readable errors', () => {
    expect(validateConfig('workspace', {settings: {jobs: 0}})).toEqual([
      '(top level): must have required property \'version\'',
      '/settings/jobs: must be >= 1'
    ]);
    expect(validateConfig('group', {
      repos: [{name: 'b', enabled: 'no'}, {tags: []}, 5], bogus: 1
    })).toEqual([
      '(top level): unknown property "bogus"',
      '/repos/0/enabled: must be boolean',
      '/repos/1: must have property "name" or "url"',
      '/repos/2: must be string or object'
    ]);
  });

  it('rejects control characters and a .git repo name', () => {
    expect(validateConfig('group', {
      title: 'evil\u001b[2J',
      repos: [{name: '.git'}, {name: '.github'}, 'ok',
        {url: 'x\u0007', name: 'y'}]
    })).toEqual([
      '/repos/0/name: is not allowed',
      '/repos/3/url: must not contain control characters',
      '/title: must not contain control characters'
    ]);
    expect(validateConfig('workspace', {
      version: 1, aliases: {up: 'pull\n--rebase', ok: ['a\u009b']}
    })).toEqual([
      '/aliases/ok/0: must not contain control characters',
      '/aliases/up: must not contain control characters'
    ]);
  });
});
