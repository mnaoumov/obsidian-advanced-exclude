import {
  describe,
  expect,
  it
} from 'vitest';

import {
  doesMatchPropertyRules,
  findMatchingPropertyRule,
  parsePropertyRules
} from './property-rules.ts';

describe('parsePropertyRules', () => {
  it('parses key: value and key-only lines, lower-casing both', () => {
    expect(parsePropertyRules('Visibility: GM-only\r\ndraft')).toEqual([
      { key: 'visibility', lineNumber: 1, text: 'Visibility: GM-only', value: 'gm-only' },
      { key: 'draft', lineNumber: 2, text: 'draft', value: null }
    ]);
  });

  it('skips empty lines, comments and lines with no key', () => {
    expect(parsePropertyRules('\n  \n# a comment\n: orphan\nstatus: done')).toEqual([{ key: 'status', lineNumber: 5, text: 'status: done', value: 'done' }]);
  });

  it('treats an empty value as any value', () => {
    expect(parsePropertyRules('status:   ')).toEqual([{ key: 'status', lineNumber: 1, text: 'status:   ', value: null }]);
  });

  it('drops matching quotes around a value, and keeps a lone or unmatched quote', () => {
    expect(parsePropertyRules('a: "x y"\nb: \'z\'\nc: "\nd: "w\'')).toEqual([
      { key: 'a', lineNumber: 1, text: 'a: "x y"', value: 'x y' },
      { key: 'b', lineNumber: 2, text: 'b: \'z\'', value: 'z' },
      { key: 'c', lineNumber: 3, text: 'c: "', value: '"' },
      { key: 'd', lineNumber: 4, text: 'd: "w\'', value: '"w\'' }
    ]);
  });

  it('keeps everything after the first colon as the value', () => {
    expect(parsePropertyRules('url: https://example.com')).toEqual([{ key: 'url', lineNumber: 1, text: 'url: https://example.com', value: 'https://example.com' }]);
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

  it('names the first rule a note matches', () => {
    expect(findMatchingPropertyRule({ draft: 'TRUE', secret: 'x' }, rules)?.lineNumber).toBe(2);
    expect(findMatchingPropertyRule({ other: 'x' }, rules)).toBeNull();
  });

  it('does not match a note without the property, without frontmatter, or with no rules', () => {
    expect(doesMatchPropertyRules({ other: 'gm-only' }, rules)).toBe(false);
    expect(doesMatchPropertyRules(undefined, rules)).toBe(false);
    expect(doesMatchPropertyRules({ visibility: 'gm-only' }, [])).toBe(false);
  });
});
