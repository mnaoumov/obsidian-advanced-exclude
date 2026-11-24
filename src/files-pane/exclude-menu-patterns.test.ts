import ignore from 'ignore';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  appendPatternLines,
  createExcludeEverythingElseLines,
  createExcludeLine,
  escapePatternPath,
  getCommonParentPath
} from './exclude-menu-patterns.ts';

function isIgnoredBy(lines: readonly string[], path: string): boolean {
  return ignore().add(lines.join('\n')).ignores(path);
}

describe('escapePatternPath', () => {
  it('should escape the characters a gitignore line gives a meaning', () => {
    expect(escapePatternPath('a*b?c[d]\\e')).toBe('a\\*b\\?c\\[d]\\\\e');
  });

  it('should escape trailing spaces only', () => {
    expect(escapePatternPath('a b  ')).toBe('a b\\ \\ ');
  });

  it('should match the path literally', () => {
    const line = createExcludeLine({ isFolder: false, path: 'notes/[draft] *.md' });
    expect(isIgnoredBy([line], 'notes/[draft] *.md')).toBe(true);
    expect(isIgnoredBy([line], 'notes/d anything.md')).toBe(false);
  });
});

describe('createExcludeLine', () => {
  it('should anchor a file at the vault root', () => {
    expect(createExcludeLine({ isFolder: false, path: 'a/b.md' })).toBe('/a/b.md');
  });

  it('should end a folder with a slash', () => {
    const line = createExcludeLine({ isFolder: true, path: 'a/b' });
    expect(line).toBe('/a/b/');
    expect(isIgnoredBy([line], 'a/b/')).toBe(true);
    expect(isIgnoredBy([line], 'x/a/b/')).toBe(false);
  });
});

describe('createExcludeEverythingElseLines', () => {
  it('should exclude the siblings and keep the targets', () => {
    const lines = createExcludeEverythingElseLines([{ isFolder: true, path: 'a/keep' }, { isFolder: false, path: 'a/keep.md' }]);
    expect(lines).toStrictEqual(['/a/*', '!/a/keep/', '!/a/keep.md']);
    const nonNullLines = lines ?? [];
    expect(isIgnoredBy(nonNullLines, 'a/other.md')).toBe(true);
    expect(isIgnoredBy(nonNullLines, 'a/other/')).toBe(true);
    expect(isIgnoredBy(nonNullLines, 'a/keep/')).toBe(false);
    expect(isIgnoredBy(nonNullLines, 'a/keep/inner.md')).toBe(false);
    expect(isIgnoredBy(nonNullLines, 'a/keep.md')).toBe(false);
    expect(isIgnoredBy(nonNullLines, 'b.md')).toBe(false);
  });

  it('should use the vault root for a top-level item', () => {
    expect(createExcludeEverythingElseLines([{ isFolder: false, path: 'a.md' }])).toStrictEqual(['/*', '!/a.md']);
  });

  it('should escape the folder path', () => {
    expect(createExcludeEverythingElseLines([{ isFolder: false, path: 'a*/b.md' }])).toStrictEqual(['/a\\*/*', '!/a\\*/b.md']);
  });

  it('should return null for items in different folders', () => {
    expect(createExcludeEverythingElseLines([{ isFolder: false, path: 'a/b.md' }, { isFolder: false, path: 'c.md' }])).toBeNull();
  });
});

describe('getCommonParentPath', () => {
  it('should return null for no items', () => {
    expect(getCommonParentPath([])).toBeNull();
  });

  it('should return the shared folder', () => {
    expect(getCommonParentPath([{ isFolder: false, path: 'a/b/c.md' }, { isFolder: true, path: 'a/b/d' }])).toBe('a/b');
  });
});

describe('appendPatternLines', () => {
  it('should append to an empty text', () => {
    expect(appendPatternLines('', ['/a'])).toStrictEqual({ addedLines: ['/a'], text: '/a\n' });
  });

  it('should start a new line after a text without a final line break', () => {
    expect(appendPatternLines('# x', ['/a'])).toStrictEqual({ addedLines: ['/a'], text: '# x\n/a\n' });
  });

  it('should not add a blank line after a final line break', () => {
    expect(appendPatternLines('# x\n', ['/a'])).toStrictEqual({ addedLines: ['/a'], text: '# x\n/a\n' });
  });

  it('should skip lines the text already has, and repeated ones', () => {
    expect(appendPatternLines('/a/*\r\n!/a/b', ['/a/*', '!/a/c', '!/a/c'])).toStrictEqual({ addedLines: ['!/a/c'], text: '/a/*\r\n!/a/b\n!/a/c\n' });
  });

  it('should leave the text as it is when nothing is new', () => {
    expect(appendPatternLines('/a\n', ['/a'])).toStrictEqual({ addedLines: [], text: '/a\n' });
  });
});
