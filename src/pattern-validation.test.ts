import {
  describe,
  expect,
  it
} from 'vitest';

import type { PatternFinding } from './pattern-validation.ts';

import {
  PatternFindingSeverity,
  validatePatterns
} from './pattern-validation.ts';

const { Error: ERROR, Warning: WARNING } = PatternFindingSeverity;

describe('validatePatterns', () => {
  it('should find nothing in empty text, blank lines, comments and ordinary patterns', () => {
    expect(validatePatterns({ areDirectivesAllowed: false, text: '' })).toStrictEqual([]);
    expect(check([
      '',
      ' '.repeat(3),
      '# a comment [ \\',
      String.raw`\#not-a-comment`,
      '/anchored/',
      '/.*/',
      '/Notes (old)/',
      '/C++/',
      '/$RECYCLE.BIN/',
      '!keep.md',
      String.raw`\!literal`,
      '*.md',
      '**/build/',
      'a/**/b',
      '[abc].md',
      '[!a-z]x',
      '[]a]x',
      '[[:alpha:]]x',
      '[[:x]',
      String.raw`a\[b`,
      String.raw`[a\]]`,
      String.raw`[\-a]`,
      String.raw`[a-\z]`,
      String.raw`name\ `,
      String.raw`foo\.md`,
      String.raw`a\\b`,
      'tab\t'
    ])).toStrictEqual([]);
  });

  it('should report a never-closed bracket as an error', () => {
    expect(check(['a[b', '[', '[a\\', '[[:alpha:', '[z-\\'])).toStrictEqual([
      [1, ERROR, 'The `[` at column 2 is never closed, so this line matches nothing. Write `\\[` for a bracket.'],
      [2, ERROR, 'The `[` at column 1 is never closed, so this line matches nothing. Write `\\[` for a bracket.'],
      [3, ERROR, 'The `[` at column 1 is never closed, so this line matches nothing. Write `\\[` for a bracket.'],
      [4, ERROR, 'The `[` at column 1 is never closed, so this line matches nothing. Write `\\[` for a bracket.'],
      [5, ERROR, 'The `[` at column 1 is never closed, so this line matches nothing. Write `\\[` for a bracket.']
    ]);
  });

  it('should report an unknown character class as an error and a backwards range as a warning', () => {
    expect(check(['[[:foo:]]x', '[c-a]', String.raw`[c-\a]`])).toStrictEqual([
      [1, ERROR, 'Unknown character class `[:foo:]`, so this line matches nothing.'],
      [2, WARNING, 'The range `c-a` runs backwards, so it matches only `c`.'],
      [3, WARNING, 'The range `c-a` runs backwards, so it matches only `c`.']
    ]);
  });

  it('should report a trailing lone backslash as an error', () => {
    expect(check(['a\\', 'a\\\\\\'])).toStrictEqual([
      [1, ERROR, 'A line cannot end with a single `\\`, so this line matches nothing. Write `\\\\` for a backslash.'],
      [2, ERROR, 'A line cannot end with a single `\\`, so this line matches nothing. Write `\\\\` for a backslash.']
    ]);
  });

  it('should warn about a backslash used as a path separator', () => {
    expect(check([String.raw`notes\daily`, String.raw`notes\2024`])).toStrictEqual([
      [1, WARNING, '`\\d` is just `d`: a backslash only escapes the next character. Write `/` between folders.'],
      [2, WARNING, '`\\2` is just `2`: a backslash only escapes the next character. Write `/` between folders.']
    ]);
  });

  it('should warn about trailing spaces that are dropped, but not about an escaped one', () => {
    const message = 'Trailing spaces are dropped. Write `\\ ` for a space that is part of the name.';
    expect(check(['a ', String.raw`a\  `, String.raw`a\\ `])).toStrictEqual([
      [1, WARNING, message],
      [2, WARNING, message],
      [3, WARNING, message]
    ]);
  });

  it('should report a bare negation and a dot segment as errors', () => {
    const dotMessage = 'A `.` or `..` path segment never matches: vault paths have none. Write `/folder` for a folder at the root.';
    expect(check(['!', './a', 'a/../b', '!./a', '.'])).toStrictEqual([
      [1, ERROR, '`!` needs a pattern after it.'],
      [2, ERROR, dotMessage],
      [3, ERROR, dotMessage],
      [4, ERROR, dotMessage],
      [5, ERROR, dotMessage]
    ]);
  });

  it('should warn about a full path on disk and about a regular expression', () => {
    const regExpMessage = 'This looks like a regular expression, as in Obsidian\'s `Excluded files`. Here it is a gitignore pattern for a folder at the vault root.';
    expect(check(['C:/vault/a', '/^daily/', '/a|b/', '/a.+/', '/end$/', String.raw`!/x\s/`])).toStrictEqual([
      [1, WARNING, 'This looks like a full path on disk. Patterns are relative to the vault root: write `/folder` for a folder at the root.'],
      [2, WARNING, regExpMessage],
      [3, WARNING, regExpMessage],
      [4, WARNING, regExpMessage],
      [5, WARNING, regExpMessage],
      [6, WARNING, '`\\s` is just `s`: a backslash only escapes the next character. Write `/` between folders.'],
      [6, WARNING, regExpMessage]
    ]);
  });

  it('should warn about a directive outside a profile, and leave directives to the expansion inside one', () => {
    const lines = ['@import Work', '@reset', '@importer', String.raw`\@import x[`];
    expect(check(lines)).toStrictEqual([
      [1, WARNING, '`@import` and `@reset` work only in a profile. Here this line is a pattern for a name that starts with `@`.'],
      [2, WARNING, '`@import` and `@reset` work only in a profile. Here this line is a pattern for a name that starts with `@`.'],
      [4, ERROR, 'The `[` at column 11 is never closed, so this line matches nothing. Write `\\[` for a bracket.']
    ]);
    expect(check(lines, true)).toStrictEqual([
      [4, ERROR, 'The `[` at column 11 is never closed, so this line matches nothing. Write `\\[` for a bracket.']
    ]);
  });

  it('should number lines split on CRLF the same as on LF', () => {
    expect(validatePatterns({ areDirectivesAllowed: false, text: 'ok\r\n!\r\n' })).toStrictEqual<PatternFinding[]>([
      { lineNumber: 2, message: '`!` needs a pattern after it.', severity: ERROR }
    ]);
  });
});

function check(lines: readonly string[], areDirectivesAllowed = false): [number, PatternFindingSeverity, string][] {
  return validatePatterns({ areDirectivesAllowed, text: lines.join('\n') }).map((finding) => [finding.lineNumber, finding.severity, finding.message]);
}
