import {describe, expect, it} from 'vitest';
import {parseOutdated} from '../../lib/commands/npm.js';

describe('parseOutdated', () => {
  it('parses npm outdated --json output', () => {
    expect(parseOutdated('')).toEqual([]);
    expect(parseOutdated('{}')).toEqual([]);
    expect(parseOutdated(JSON.stringify({
      zod: {current: '3.0.0', wanted: '3.1.0', latest: '4.0.0'},
      chai: [
        {current: '4.0.0', wanted: '4.0.1', latest: '5.0.0'},
        {wanted: '4.0.1', latest: '5.0.0'}
      ]
    }))).toEqual([
      {name: 'chai', current: '4.0.0', wanted: '4.0.1', latest: '5.0.0'},
      {name: 'chai', current: null, wanted: '4.0.1', latest: '5.0.0'},
      {name: 'zod', current: '3.0.0', wanted: '3.1.0', latest: '4.0.0'}
    ]);
  });
});
