import {describe, expect, it} from 'vitest';
import {hasNoPrefixOption, prefixLines} from '../../lib/commands/grep.js';
import {createColors} from '../../lib/output/format.js';

describe('hasNoPrefixOption', () => {
  it('detects options that change line format', () => {
    expect(hasNoPrefixOption(['-n', 'foo'])).toBe(false);
    expect(hasNoPrefixOption(['--heading', 'foo'])).toBe(true);
    expect(hasNoPrefixOption(['-nh', 'foo'])).toBe(true);
    expect(hasNoPrefixOption(['-z', 'foo'])).toBe(true);
    expect(hasNoPrefixOption(['--null', 'foo'])).toBe(true);
  });

  it('ignores option values and paths', () => {
    expect(hasNoPrefixOption(['-e', '-h', 'foo'])).toBe(false);
    expect(hasNoPrefixOption(['-ehz'])).toBe(false);
    expect(hasNoPrefixOption(['foo', '--', '-h'])).toBe(false);
  });
});

describe('prefixLines', () => {
  const c = createColors(false);

  it('prefixes file lines but not separators', () => {
    const output = 'a.js:1:x\n--\nb.js:2:y\nBinary file c.bin matches\n';
    expect(prefixLines(output, 'repo', c)).toBe(
      'repo/a.js:1:x\n--\nrepo/b.js:2:y\nBinary file repo/c.bin matches\n');
  });

  it('leaves output alone for the current repo', () => {
    expect(prefixLines('a.js:x\n', '', c)).toBe('a.js:x\n');
  });
});
