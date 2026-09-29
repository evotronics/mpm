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
});
