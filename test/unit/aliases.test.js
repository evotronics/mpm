import {commandIndex, splitWords} from '../../lib/cli/aliases.js';
import {describe, expect, it} from 'vitest';
import {urlKey} from '../../lib/commands/doctor.js';

describe('splitWords', () => {
  it('splits like a shell', () => {
    expect(splitWords('a  b')).toEqual(['a', 'b']);
    expect(splitWords('exec -- sh -c "echo $X \\"q\\""'))
      .toEqual(['exec', '--', 'sh', '-c', 'echo $X "q"']);
    expect(splitWords('\'a b\' c\\ d ""')).toEqual(['a b', 'c d', '']);
    expect(() => splitWords('"open')).toThrow(/Unterminated/);
  });
});

describe('commandIndex', () => {
  it('skips global options and their values', () => {
    expect(commandIndex(['-C', 'dir', '-n', 'up', 'x'])).toBe(3);
    expect(commandIndex(['--jobs', '4', '--json', 'up'])).toBe(3);
    expect(commandIndex(['-j4', 'up'])).toBe(1);
    expect(commandIndex(['--help'])).toBe(-1);
  });
});

describe('urlKey', () => {
  it('compares URLs across protocols', () => {
    expect(urlKey('git@github.com:X/y.git'))
      .toBe(urlKey('https://github.com/x/y'));
    expect(urlKey('ssh://git@github.com/x/y.git')).toBe('github.com/x/y');
    expect(urlKey('/srv/git/y.git')).toBe('/srv/git/y');
  });
});
