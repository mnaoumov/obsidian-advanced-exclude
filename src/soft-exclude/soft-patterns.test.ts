import {
  describe,
  expect,
  it
} from 'vitest';

import {
  ExcludeMode,
  PluginSettings
} from '../settings/plugin-settings.ts';
import {
  hasSoftPatterns,
  isSoftExcludeActive,
  SoftPatternsTester
} from './soft-patterns.ts';

function createSettings(excludeMode: ExcludeMode, softIgnorePatterns: string): PluginSettings {
  const settings = new PluginSettings();
  settings.excludeMode = excludeMode;
  settings.softIgnorePatterns = softIgnorePatterns;
  return settings;
}

describe('hasSoftPatterns', () => {
  it('counts no blank line and no comment as a pattern', () => {
    expect(hasSoftPatterns('')).toBe(false);
    expect(hasSoftPatterns('\n  \n# comment\n')).toBe(false);
  });

  it('counts any other line as a pattern', () => {
    expect(hasSoftPatterns('# comment\nscripts/')).toBe(true);
  });
});

describe('isSoftExcludeActive', () => {
  it('is active in the soft mode with no soft pattern', () => {
    const settings = createSettings(ExcludeMode.Soft, '');
    expect(isSoftExcludeActive({ effectiveSettings: settings, settings })).toBe(true);
  });

  it('is active in another mode while a soft pattern is set', () => {
    const settings = createSettings(ExcludeMode.Full, 'scripts/');
    expect(isSoftExcludeActive({ effectiveSettings: settings, settings })).toBe(true);
  });

  it('is inactive in another mode with no soft pattern', () => {
    const settings = createSettings(ExcludeMode.FilesPane, '# only a comment');
    expect(isSoftExcludeActive({ effectiveSettings: settings, settings })).toBe(false);
  });
});

describe('SoftPatternsTester', () => {
  it('matches nothing without patterns', () => {
    const tester = new SoftPatternsTester('');
    expect(tester.hasPatterns).toBe(false);
    expect(tester.isIgnored('a.md', false)).toBe(false);
  });

  it('matches a file, a folder and what the folder holds, ignoring case', () => {
    const tester = new SoftPatternsTester('Scripts/\n*.JS');
    expect(tester.isIgnored('scripts', true)).toBe(true);
    expect(tester.isIgnored('scripts/delete.md', false)).toBe(true);
    expect(tester.isIgnored('other/run.js', false)).toBe(true);
    expect(tester.isIgnored('other/note.md', false)).toBe(false);
  });

  it('tests a folder in its folder form, so a whitelist keeps folders traversable', () => {
    const tester = new SoftPatternsTester('*\n!*/\n!*.md');
    expect(tester.isIgnored('folder', true)).toBe(false);
    expect(tester.isIgnored('folder/note.md', false)).toBe(false);
    expect(tester.isIgnored('folder/image.png', false)).toBe(true);
  });

  it('never matches the vault root', () => {
    const tester = new SoftPatternsTester('*');
    expect(tester.isIgnored('/', true)).toBe(false);
    expect(tester.isIgnored('', true)).toBe(false);
  });
});
