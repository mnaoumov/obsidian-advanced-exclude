import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  createExcludedFilesMatchers,
  findExcludedFilesMatch
} from './excluded-files.ts';
import { PatternLayer } from './marked-pattern-tester.ts';

describe('excluded files', () => {
  it('matches a path prefix and a /regular expression/, case-insensitively, naming the entry', () => {
    const matchers = createExcludedFilesMatchers(['Templates/', '/\\.tmp$/']);

    expect(findExcludedFilesMatch(matchers, 'templates/daily.md', false)).toStrictEqual({ layer: PatternLayer.ExcludedFiles, lineNumber: 1, text: 'Templates/' });
    expect(findExcludedFilesMatch(matchers, 'a/b.TMP', false)?.lineNumber).toBe(2);
    expect(findExcludedFilesMatch(matchers, 'notes/a.md', false)).toBeNull();
  });

  it('tests a folder in its plain and its trailing-slash form', () => {
    const matchers = createExcludedFilesMatchers(['Templates/']);

    expect(findExcludedFilesMatch(matchers, 'Templates', true)?.text).toBe('Templates/');
    expect(findExcludedFilesMatch(matchers, 'Templates', false)).toBeNull();
  });

  it('skips an invalid regular expression, keeping the numbering of the others', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const matchers = createExcludedFilesMatchers(['/[/', 'Archive']);

    expect(consoleError).toHaveBeenCalledWith('Invalid exclude filter: /[/');
    expect(matchers.map((matcher) => matcher.origin.lineNumber)).toStrictEqual([2]);
    consoleError.mockRestore();
  });

  it('takes a lone slash as a path prefix', () => {
    expect(findExcludedFilesMatch(createExcludedFilesMatchers(['/']), '/x', false)?.text).toBe('/');
  });
});
