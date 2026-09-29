import {describe, expect, it} from 'vitest';
import {insertEntry, newEntry, removeEntry, updateEntry}
  from '../../lib/config/repos.js';
import {parseYaml, stringifyYaml} from '../../lib/config/files.js';

const SOURCE = `# Group comment.
repos:
  - alpha # inline
  # before gamma
  - gamma
  - name: old
    enabled: false
    tags: [legacy]
  - other/zeta
`;

function edit(fn) {
  const document = parseYaml(SOURCE);
  fn(document);
  return stringifyYaml(document);
}

describe('newEntry', () => {
  it('uses the shortest form', () => {
    expect(newEntry({ref: 'a'})).toBe('a');
    expect(newEntry({ref: 'o/a'})).toBe('o/a');
    expect(newEntry({ref: 'a', enabled: false}))
      .toEqual({name: 'a', enabled: false});
    expect(newEntry({ref: 'o/a', tags: ['t']}))
      .toEqual({url: 'o/a', tags: ['t']});
    expect(newEntry({ref: 'a', name: 'b'})).toEqual({name: 'b', url: 'a'});
  });
});

describe('repo entry editing', () => {
  it('inserts in sorted position before attached comments', () => {
    expect(edit(d => {
      insertEntry(d, 'beta');
      insertEntry(d, 'zz');
    })).toBe(`# Group comment.
repos:
  - alpha # inline
  - beta
  # before gamma
  - gamma
  - name: old
    enabled: false
    tags: [legacy]
  - other/zeta
  - zz
`);
  });

  it('converts between short and long forms keeping comments', () => {
    expect(edit(d => {
      updateEntry(d, 'gamma', data => ({...data, enabled: false}));
      updateEntry(d, 'old', () => ({name: 'old'}));
      updateEntry(d, 'zeta', data => ({...data, tags: ['x']}));
    })).toBe(`# Group comment.
repos:
  - alpha # inline
  # before gamma
  - name: gamma
    enabled: false
  - old
  - url: other/zeta
    tags: [x]
`);
  });

  it('removes entries and reports missing ones', () => {
    const document = parseYaml(SOURCE);
    expect(removeEntry(document, 'gamma')).toBe(true);
    expect(removeEntry(document, 'nope')).toBe(false);
    expect(updateEntry(document, 'nope', d => d)).toBe(false);
    expect(stringifyYaml(document)).not.toMatch(/- gamma/);
  });
});
