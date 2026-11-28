import ignore from 'ignore';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PatternLineOrigin } from './marked-pattern-tester.ts';

import {
  MarkedPatternTester,
  PatternLayer,
  toPatternLineOrigins
} from './marked-pattern-tester.ts';

interface FixturePath {
  readonly isFolder: boolean;
  readonly path: string;
}

const FIXTURE_PATHS: readonly FixturePath[] = [
  { isFolder: false, path: 'note.md' },
  { isFolder: false, path: 'image.png' },
  { isFolder: true, path: 'Archive' },
  { isFolder: false, path: 'Archive/old.md' },
  { isFolder: false, path: 'Archive/keep.md' },
  { isFolder: true, path: 'Archive/Sub' },
  { isFolder: false, path: 'Archive/Sub/deep.md' },
  { isFolder: true, path: 'Projects' },
  { isFolder: false, path: 'Projects/plan.md' },
  { isFolder: false, path: 'Projects/data.csv' },
  { isFolder: true, path: 'build' },
  { isFolder: false, path: 'build/out.js' },
  { isFolder: false, path: 'Private/secret.md' },
  { isFolder: false, path: 'READ ME.MD' }
];

const FIXTURE_PATTERN_SETS: readonly string[] = [
  '',
  'Archive/\n!Archive/keep.md',
  'Archive/*\n!Archive/keep.md',
  '*\n!*/\n!*.md',
  '*.md\n!Projects/\n# comment\n\nbuild',
  '/Private/\n*.png\n!image.png\n*.png',
  'archive/sub/\n!Archive/Sub/deep.md\nread me.md'
];

function layered(text: string): PatternLineOrigin[] {
  return toPatternLineOrigins(text, { layer: PatternLayer.GlobalPatterns });
}

describe('MarkedPatternTester', () => {
  describe('agrees with the plain matcher it replaced, for every fixture path', () => {
    for (const patterns of FIXTURE_PATTERN_SETS) {
      it(`patterns ${JSON.stringify(patterns)}`, () => {
        const plain = ignore({ ignoreCase: true }).add(patterns.split('\n'));
        const tester = new MarkedPatternTester(layered(patterns));
        for (const { isFolder, path } of FIXTURE_PATHS) {
          const isExpected = plain.ignores(isFolder ? `${path}/` : path);
          expect(tester.ignores(path, isFolder), path).toBe(isExpected);
          expect(tester.explain(path, isFolder).isIgnored, path).toBe(isExpected);
        }
      });
    }
  });

  it('names the line that excludes a path, with its layer and line number', () => {
    const tester = new MarkedPatternTester([
      ...layered('# notes\n*.md'),
      ...toPatternLineOrigins('build/', { layer: PatternLayer.LocalPatterns })
    ]);

    expect(tester.explain('a/b.md', false)).toStrictEqual({
      decidingLine: { layer: PatternLayer.GlobalPatterns, lineNumber: 2, text: '*.md' },
      excludedFolderPath: null,
      isIgnored: true,
      overriddenLines: []
    });
    expect(tester.explain('build', true).decidingLine).toStrictEqual({ layer: PatternLayer.LocalPatterns, lineNumber: 1, text: 'build/' });
  });

  it('names the ! line that brought a path back, and the line it overrode', () => {
    const tester = new MarkedPatternTester(layered('Archive/*\n!Archive/keep.md'));

    expect(tester.explain('Archive/keep.md', false)).toStrictEqual({
      decidingLine: { layer: PatternLayer.GlobalPatterns, lineNumber: 2, text: '!Archive/keep.md' },
      excludedFolderPath: null,
      isIgnored: false,
      overriddenLines: [{ layer: PatternLayer.GlobalPatterns, lineNumber: 1, text: 'Archive/*' }]
    });
  });

  it('names the ! line a later line overrode', () => {
    const tester = new MarkedPatternTester(layered('*.png\n!image.png\n*.png'));

    const explanation = tester.explain('image.png', false);

    expect(explanation.isIgnored).toBe(true);
    expect(explanation.decidingLine?.lineNumber).toBe(3);
    expect(explanation.overriddenLines.map((line) => line.lineNumber)).toStrictEqual([2]);
  });

  it('names the excluded folder a ! line cannot reach into', () => {
    const tester = new MarkedPatternTester(layered('Archive/\n!Archive/keep.md'));

    const explanation = tester.explain('Archive/keep.md', false);

    expect(explanation.isIgnored).toBe(true);
    expect(explanation.decidingLine?.text).toBe('Archive/');
    expect(explanation.excludedFolderPath).toBe('Archive');
    // The `!` line is earlier than nothing: the folder's own line decides, and it comes first.
    expect(explanation.overriddenLines).toStrictEqual([]);
  });

  it('reports no deciding line for a path no line matches', () => {
    const tester = new MarkedPatternTester(layered('build/'));

    expect(tester.explain('note.md', false)).toStrictEqual({
      decidingLine: null,
      excludedFolderPath: null,
      isIgnored: false,
      overriddenLines: []
    });
  });

  it('names the ! line that brought back a folder above the path', () => {
    const tester = new MarkedPatternTester(layered('Archive/\n!Archive/'));

    const explanation = tester.explain('Archive/old.md', false);

    expect(explanation.isIgnored).toBe(false);
    expect(explanation.decidingLine?.text).toBe('!Archive/');
    expect(explanation.overriddenLines.map((line) => line.text)).toStrictEqual(['Archive/']);
  });

  it('never excludes the vault root', () => {
    const tester = new MarkedPatternTester(layered('*'));

    expect(tester.explain('', true).isIgnored).toBe(false);
    expect(tester.explain('/', true).decidingLine).toBeNull();
  });

  it('keeps the layer details of every line', () => {
    expect(toPatternLineOrigins('a\r\nb', { filePath: 'x.txt', layer: PatternLayer.ImportedFile, profileName: 'Work' })).toStrictEqual([
      { filePath: 'x.txt', layer: PatternLayer.ImportedFile, lineNumber: 1, profileName: 'Work', text: 'a' },
      { filePath: 'x.txt', layer: PatternLayer.ImportedFile, lineNumber: 2, profileName: 'Work', text: 'b' }
    ]);
    expect(toPatternLineOrigins('', { layer: PatternLayer.GitIgnore })).toStrictEqual([]);
  });
});
