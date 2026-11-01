import {
  describe,
  expect,
  it
} from 'vitest';

import {
  doesMatchPropertyRules,
  parsePropertyRules
} from './property-rules.ts';

describe('parsePropertyRules', () => {
  it('parses key: value and key-only lines, lower-casing both', () => {
    expect(parsePropertyRules('Visibility: GM-only\r\ndraft')).toEqual([
      { key: 'visibility', value: 'gm-only' },
      { key: 'draft', value: null }
    ]);
  });

  it('skips empty lines, comments and lines with no key', () => {
    expect(parsePropertyRules('\n  \n# a comment\n: orphan\nstatus: done')).toEqual([{ key: 'status', value: 'done' }]);
  });

  it('treats an empty value as any value', () => {
    expect(parsePropertyRules('status:   ')).toEqual([{ key: 'status', value: null }]);
  });

  it('drops matching quotes around a value, and keeps a lone or unmatched quote', () => {
    expect(parsePropertyRules('a: "x y"\nb: \'z\'\nc: "\nd: "w\'')).toEqual([
      { key: 'a', value: 'x y' },
      { key: 'b', value: 'z' },
      { key: 'c', value: '"' },
      { key: 'd', value: '"w\'' }
    ]);
  });

  it('keeps everything after the first colon as the value', () => {
    expect(parsePropertyRules('url: https://example.com')).toEqual([{ key: 'url', value: 'https://example.com' }]);
  });

  it('returns no rules for empty text', () => {
    expect(parsePropertyRules('')).toEqual([]);
  });
});

describe('doesMatchPropertyRules', () => {
  const rules = parsePropertyRules('visibility: gm-only\ndraft: true\nsecret');

  it('matches a value case-insensitively, keys included', () => {
    expect(doesMatchPropertyRules({ Visibility: 'GM-Only' }, rules)).toBe(true);
  });

  it('matches a boolean or a number as text', () => {
    expect(doesMatchPropertyRules({ draft: true }, rules)).toBe(true);
    expect(doesMatchPropertyRules({ draft: false }, rules)).toBe(false);
    expect(doesMatchPropertyRules({ priority: 1 }, parsePropertyRules('priority: 1'))).toBe(true);
  });

  it('matches any item of a list', () => {
    expect(doesMatchPropertyRules({ visibility: ['public', 'gm-only'] }, rules)).toBe(true);
    expect(doesMatchPropertyRules({ visibility: ['public'] }, rules)).toBe(false);
  });

  it('matches a key-only rule on any non-empty value', () => {
    expect(doesMatchPropertyRules({ secret: 'yes' }, rules)).toBe(true);
    expect(doesMatchPropertyRules({ secret: false }, rules)).toBe(true);
    expect(doesMatchPropertyRules({ secret: '' }, rules)).toBe(false);
    expect(doesMatchPropertyRules({ secret: null }, rules)).toBe(false);
    expect(doesMatchPropertyRules({ secret: [] }, rules)).toBe(false);
    expect(doesMatchPropertyRules({ secret: { nested: 'x' } }, rules)).toBe(false);
  });

  it('does not match a note without the property, without frontmatter, or with no rules', () => {
    expect(doesMatchPropertyRules({ other: 'gm-only' }, rules)).toBe(false);
    expect(doesMatchPropertyRules(undefined, rules)).toBe(false);
    expect(doesMatchPropertyRules({ visibility: 'gm-only' }, [])).toBe(false);
  });
});
