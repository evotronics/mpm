import {describe, expect, it} from 'vitest';
import {printable} from '../../lib/util/text.js';

describe('printable', () => {
  it('escapes control characters', () => {
    expect(printable('a\u001b[31mb\nc\u009bd')).toBe('a\\x1b[31mb\\x0ac\\x9bd');
    expect(printable('plain – ünïcode')).toBe('plain – ünïcode');
  });
});
