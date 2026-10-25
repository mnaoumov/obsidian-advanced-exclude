import {
  describe,
  expect,
  it
} from 'vitest';

import {
  formatLocalPatternsFile,
  LOCAL_PATTERNS_HEADER,
  normalizeLocalPatterns
} from './local-patterns.ts';

describe('normalizeLocalPatterns', () => {
  it('should keep LF content as it is', () => {
    expect(normalizeLocalPatterns('a/\nb/\n')).toBe('a/\nb/\n');
  });

  it('should turn CRLF into LF', () => {
    expect(normalizeLocalPatterns('a/\r\nb/\r\n')).toBe('a/\nb/\n');
  });

  it('should turn mixed line endings and a lone CR into LF', () => {
    expect(normalizeLocalPatterns('a/\r\nb/\nc/\rd/\r')).toBe('a/\nb/\nc/\nd/\n');
  });

  it('should strip a byte order mark', () => {
    expect(normalizeLocalPatterns('\u{FEFF}a/\r\n')).toBe('a/\n');
  });
});

describe('formatLocalPatternsFile', () => {
  it('should give a new file the platform line ending and no byte order mark', () => {
    expect(formatLocalPatternsFile({ existingContent: null, isWindows: true, text: 'a/\nb/' })).toBe('a/\r\nb/');
    expect(formatLocalPatternsFile({ existingContent: null, isWindows: false, text: 'a/\nb/' })).toBe('a/\nb/');
  });

  it('should keep the LF line ending of an existing file, even on Windows', () => {
    expect(formatLocalPatternsFile({ existingContent: 'old/\n', isWindows: true, text: 'a/\nb/' })).toBe('a/\nb/');
  });

  it('should keep the CRLF line ending of an existing file, a mixed one included', () => {
    expect(formatLocalPatternsFile({ existingContent: 'old/\r\nolder/\n', isWindows: false, text: 'a/\nb/' })).toBe('a/\r\nb/');
  });

  it('should keep a byte order mark the file has', () => {
    expect(formatLocalPatternsFile({ existingContent: '\u{FEFF}old/\r\n', isWindows: false, text: 'a/\n' })).toBe('\u{FEFF}a/\r\n');
  });

  it('should normalize line endings the edited text already carries', () => {
    expect(formatLocalPatternsFile({ existingContent: 'old/\n', isWindows: false, text: 'a/\r\nb/' })).toBe('a/\nb/');
  });
});

describe('LOCAL_PATTERNS_HEADER', () => {
  it('should be comment lines only, so it hides nothing', () => {
    const lines = LOCAL_PATTERNS_HEADER.split('\n').filter((line) => line !== '');

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.startsWith('#'))).toBe(true);
    expect(LOCAL_PATTERNS_HEADER).toContain('Obsidian Sync does not carry this file');
    expect(LOCAL_PATTERNS_HEADER).toContain('https://git-scm.com/docs/gitignore#_pattern_format');
  });
});
