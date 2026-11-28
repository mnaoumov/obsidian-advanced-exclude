import {
  describe,
  expect,
  it
} from 'vitest';

import type { SoftVerdictExplanation } from '../soft-exclude/soft-exclude-patch-component.ts';
import type { PatternVerdictExplanation } from './marked-pattern-tester.ts';
import type { PathExplanation } from './path-explanation.ts';

import { ExcludeMode } from '../settings/plugin-settings.ts';
import { SoftExcludeFeature } from '../soft-exclude/feature-scoped-app.ts';
import { PatternLayer } from './marked-pattern-tester.ts';
import {
  describePathExplanation,
  renderPathExplanation
} from './path-explanation.ts';

const NO_MATCH: PatternVerdictExplanation = { decidingLine: null, excludedFolderPath: null, isIgnored: false, overriddenLines: [] };
const NO_SOFT: SoftVerdictExplanation = { excludedFeatures: [], isSoftMode: false, propertyRule: null, softPatterns: null };

function explanation(overrides: Partial<PathExplanation>): PathExplanation {
  return {
    excludeMode: ExcludeMode.Full,
    isFolder: false,
    main: { excludedFilesEntry: null, isIgnored: false, patterns: NO_MATCH },
    path: 'a/b.md',
    soft: NO_SOFT,
    ...overrides
  };
}

describe('describePathExplanation', () => {
  it('says a path no line matches is not excluded', () => {
    expect(describePathExplanation(explanation({ isFolder: true, path: 'a' }))).toStrictEqual([
      'The folder `a` is not excluded.',
      'Patterns: no line matches it.'
    ]);
  });

  it('names the deciding line and the lines it overrode, by layer', () => {
    const patterns: PatternVerdictExplanation = {
      decidingLine: { layer: PatternLayer.LocalPatterns, lineNumber: 4, text: '*.md' },
      excludedFolderPath: null,
      isIgnored: true,
      overriddenLines: [
        { layer: PatternLayer.GlobalPatterns, lineNumber: 1, text: '!a/b.md' },
        { layer: PatternLayer.Profile, lineNumber: 2, profileName: 'Work', text: '!a/' },
        { filePath: 'shared.txt', layer: PatternLayer.ImportedFile, lineNumber: 3, profileName: 'Work', text: '!b.md' },
        { layer: PatternLayer.GitIgnore, lineNumber: 5, text: '!*.md' }
      ]
    };

    expect(describePathExplanation(explanation({ main: { excludedFilesEntry: null, isIgnored: true, patterns } }))).toStrictEqual([
      'The file `a/b.md` is excluded: hidden from the whole app.',
      'Patterns: excluded by `*.md`, line 4 of `.obsidianignore`.',
      'It overrides `!a/b.md`, line 1 of the global patterns.',
      'It overrides `!a/`, line 2 of the profile `Work`.',
      'It overrides `!b.md`, line 3 of `shared.txt`, which the profile `Work` imports.',
      'It overrides `!*.md`, line 5 of `.gitignore`.'
    ]);
  });

  it('leaves a missing profile or file name empty rather than failing', () => {
    const patterns: PatternVerdictExplanation = {
      decidingLine: { layer: PatternLayer.ImportedFile, lineNumber: 1, text: 'x' },
      excludedFolderPath: null,
      isIgnored: true,
      overriddenLines: [{ layer: PatternLayer.Profile, lineNumber: 2, text: '!x' }]
    };

    expect(describePathExplanation(explanation({ main: { excludedFilesEntry: null, isIgnored: true, patterns } })).slice(1)).toStrictEqual([
      'Patterns: excluded by `x`, line 1 of ``, which the profile `` imports.',
      'It overrides `!x`, line 2 of the profile ``.'
    ]);
  });

  it('says why a ! line cannot reach into an excluded folder', () => {
    const patterns: PatternVerdictExplanation = {
      decidingLine: { layer: PatternLayer.GlobalPatterns, lineNumber: 1, text: 'a/' },
      excludedFolderPath: 'a',
      isIgnored: true,
      overriddenLines: []
    };

    expect(describePathExplanation(explanation({ excludeMode: ExcludeMode.FilesPane, main: { excludedFilesEntry: null, isIgnored: true, patterns } }))).toStrictEqual([
      'The file `a/b.md` is excluded: hidden from the Files pane.',
      'Patterns: excluded by `a/`, line 1 of the global patterns.',
      'That line excludes its folder `a`, and nothing inside an excluded folder can be brought back with a `!` line; bring the folder back first.'
    ]);
  });

  it('names a ! line that brought the path back', () => {
    const patterns: PatternVerdictExplanation = {
      decidingLine: { layer: PatternLayer.GlobalPatterns, lineNumber: 2, text: '!a/b.md' },
      excludedFolderPath: null,
      isIgnored: false,
      overriddenLines: []
    };

    expect(describePathExplanation(explanation({ main: { excludedFilesEntry: null, isIgnored: false, patterns } }))[1])
      .toBe('Patterns: brought back by `!a/b.md`, line 2 of the global patterns.');
  });

  it('names the Excluded files entry', () => {
    const main = {
      excludedFilesEntry: { layer: PatternLayer.ExcludedFiles, lineNumber: 1, text: 'a/' },
      isIgnored: true,
      patterns: NO_MATCH
    };

    expect(describePathExplanation(explanation({ main }))).toStrictEqual([
      'The file `a/b.md` is excluded: hidden from the whole app.',
      'Patterns: no line matches it.',
      'Obsidian\'s `Excluded files` exclude it: `a/`, line 1 of Obsidian\'s `Excluded files`.'
    ]);
  });

  it('describes the soft mode, the soft patterns and a property rule', () => {
    const soft: SoftVerdictExplanation = {
      excludedFeatures: [SoftExcludeFeature.Search, SoftExcludeFeature.Graph, SoftExcludeFeature.UnlinkedMentions, SoftExcludeFeature.Other],
      isSoftMode: true,
      propertyRule: { key: 'draft', lineNumber: 2, text: ' draft: true ', value: 'true' },
      softPatterns: {
        decidingLine: { layer: PatternLayer.SoftPatterns, lineNumber: 1, text: 'a/' },
        excludedFolderPath: null,
        isIgnored: true,
        overriddenLines: []
      }
    };

    expect(describePathExplanation(explanation({ excludeMode: ExcludeMode.Soft, soft }))).toStrictEqual([
      'The file `a/b.md` is soft-excluded from search, graph, unlinked mentions, other features (quick switcher, link suggestions, Bases, the tag pane).',
      'Patterns: no line matches it.',
      'Soft patterns: excluded by `a/`, line 1 of the soft patterns.',
      'Its properties match `draft: true`, line 2 of `Exclude notes by property`.'
    ]);
  });

  it('says the main patterns soft-exclude in the soft mode, and when every toggle is off', () => {
    const main = {
      excludedFilesEntry: null,
      isIgnored: true,
      patterns: { decidingLine: { layer: PatternLayer.GlobalPatterns, lineNumber: 1, text: '*' }, excludedFolderPath: null, isIgnored: true, overriddenLines: [] }
    };

    expect(describePathExplanation(explanation({ excludeMode: ExcludeMode.Soft, main, soft: { ...NO_SOFT, isSoftMode: true } }))[0])
      .toBe('The file `a/b.md` is soft-excluded from nothing: every `Soft: exclude from ...` toggle is off.');
  });

  it('says a path only the soft patterns match is soft-excluded, and skips a property rule outside the soft mode', () => {
    const soft: SoftVerdictExplanation = {
      excludedFeatures: [SoftExcludeFeature.Search],
      isSoftMode: false,
      propertyRule: null,
      softPatterns: NO_MATCH
    };

    expect(describePathExplanation(explanation({ soft }))).toStrictEqual([
      'The file `a/b.md` is not excluded.',
      'Patterns: no line matches it.',
      'Soft patterns: no line matches it.'
    ]);
    expect(describePathExplanation(explanation({ soft: { ...soft, softPatterns: { ...NO_MATCH, isIgnored: true } } }))[0])
      .toBe('The file `a/b.md` is soft-excluded from search.');
  });

  it('describes a matching property rule alone as soft exclusion', () => {
    const soft: SoftVerdictExplanation = {
      excludedFeatures: [SoftExcludeFeature.Search],
      isSoftMode: true,
      propertyRule: { key: 'draft', lineNumber: 1, text: 'draft', value: null },
      softPatterns: null
    };

    expect(describePathExplanation(explanation({ excludeMode: ExcludeMode.Soft, soft }))[0]).toBe('The file `a/b.md` is soft-excluded from search.');
  });
});

describe('renderPathExplanation', () => {
  it('replaces the content with one line per sentence, code spans as code', () => {
    const el = createDiv({ text: 'Stale' });

    renderPathExplanation(el, explanation({}));

    expect([...el.children].map((child) => child.textContent)).toStrictEqual(['The file a/b.md is not excluded.', 'Patterns: no line matches it.']);
    expect(el.querySelectorAll('code')).toHaveLength(1);
  });
});
