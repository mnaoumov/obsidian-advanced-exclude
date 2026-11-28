import { escapeRegExp } from '@mnaoumov/typescript-lib/reg-exp';

import type { PatternLineOrigin } from './marked-pattern-tester.ts';

import { PatternLayer } from './marked-pattern-tester.ts';

/**
 * One entry of Obsidian's `Files and links > Excluded files`, compiled.
 */
export interface ExcludedFilesMatcher {
  readonly origin: PatternLineOrigin;
  readonly regExp: RegExp;
}

/**
 * Compiles Obsidian's `userIgnoreFilters` as Obsidian reads them: `/.../` is a regular expression, anything else a path
 * prefix, both case-insensitive. An invalid regular expression is reported and skipped.
 *
 * @returns One matcher per valid entry.
 */
export function createExcludedFilesMatchers(filters: readonly string[]): ExcludedFilesMatcher[] {
  const matchers: ExcludedFilesMatcher[] = [];
  for (const [index, filter] of filters.entries()) {
    let regExp: RegExp;
    if (filter.length > 1 && filter.startsWith('/') && filter.endsWith('/')) {
      try {
        regExp = new RegExp(filter.slice(1, -1), 'i');
      } catch {
        console.error(`Invalid exclude filter: ${filter}`);
        continue;
      }
    } else {
      regExp = new RegExp(`^${escapeRegExp(filter)}`, 'i');
    }
    matchers.push({ origin: { layer: PatternLayer.ExcludedFiles, lineNumber: index + 1, text: filter }, regExp });
  }
  return matchers;
}

/**
 * A folder is tested in both its plain and its trailing-slash form, as Obsidian's own entries are written either way.
 *
 * @returns The first entry that excludes {@link normalizedPath}, or `null`.
 */
export function findExcludedFilesMatch(matchers: readonly ExcludedFilesMatcher[], normalizedPath: string, isFolder: boolean): null | PatternLineOrigin {
  const paths = isFolder ? [normalizedPath, `${normalizedPath}/`] : [normalizedPath];
  return matchers.find((matcher) => paths.some((path) => matcher.regExp.test(path)))?.origin ?? null;
}
