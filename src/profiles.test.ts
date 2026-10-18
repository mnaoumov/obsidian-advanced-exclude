import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { SettingsProfile } from './plugin-settings.ts';

import {
  ExcludeMode,
  PluginSettings
} from './plugin-settings.ts';
import {
  createProfileId,
  createUniqueProfileName,
  duplicateProfile,
  findProfileByName,
  isFileImportName,
  MAX_IMPORT_DEPTH,
  renameProfileImports,
  resolveProfile,
  saveProfile
} from './profiles.ts';

function createSettings(overrides: Partial<PluginSettings>): PluginSettings {
  return Object.assign(new PluginSettings(), overrides);
}

function profile(name: string, patterns: string, overrides?: Partial<SettingsProfile>): SettingsProfile {
  return { id: name.toLowerCase(), name, patterns, ...overrides };
}

describe('resolveProfile', () => {
  it('should expand an imported file at its line, taking its lines literally', () => {
    const settings = createSettings({ profiles: [profile('Work', 'a/\n@import file:/ignores//work.txt \n!a/keep.md')] });
    const importedFileContents = new Map([['ignores/work.txt', '@literal\r\nb/']]);

    const result = resolveProfile({ activeProfileId: 'work', importedFileContents, settings });

    expect(result.errors).toStrictEqual([]);
    expect(result.importedFilePaths).toStrictEqual(['ignores/work.txt']);
    expect(result.lines).toStrictEqual([
      { profileName: 'Work', text: 'a/' },
      { filePath: 'ignores/work.txt', profileName: 'Work', text: '@literal' },
      { filePath: 'ignores/work.txt', profileName: 'Work', text: 'b/' },
      { profileName: 'Work', text: '!a/keep.md' }
    ]);
  });

  it('should list an imported file that has not been read yet and expand it to nothing', () => {
    const settings = createSettings({ profiles: [profile('Work', '@import File:.gitignore\n@import file:.gitignore')] });

    const result = resolveProfile({ activeProfileId: 'work', settings });

    expect(result.errors).toStrictEqual([]);
    expect(result.importedFilePaths).toStrictEqual(['.gitignore']);
    expect(result.lines).toStrictEqual([]);
  });

  it('should report a missing imported file and a file import with no path', () => {
    const settings = createSettings({ profiles: [profile('Work', '@import file:gone.txt\n@import file:  ')] });

    const result = resolveProfile({ activeProfileId: 'work', importedFileContents: new Map([['gone.txt', null]]), settings });

    expect(result.errors).toStrictEqual([
      { lineNumber: 1, message: 'File `gone.txt` does not exist.', profileName: 'Work' },
      { lineNumber: 2, message: '`@import file:` needs a vault path.', profileName: 'Work' }
    ]);
    expect(result.importedFilePaths).toStrictEqual(['gone.txt']);
  });

  it('should list no imported files when no profile is active', () => {
    expect(resolveProfile({ activeProfileId: null, settings: createSettings({}) }).importedFilePaths).toStrictEqual([]);
  });

  it('should return the base settings unchanged when no profile is active', () => {
    const settings = createSettings({ excludeMode: ExcludeMode.FilesPane, obsidianIgnoreContent: 'a/\nb/', profiles: [profile('Work', 'w/')] });

    const result = resolveProfile({ activeProfileId: null, settings });

    expect(result.activeProfile).toBeNull();
    expect(result.obsidianIgnoreContent).toBe('a/\nb/');
    expect(result.excludeMode).toBe(ExcludeMode.FilesPane);
    expect(result.errors).toStrictEqual([]);
    expect(result.lines).toStrictEqual([{ profileName: null, text: 'a/' }, { profileName: null, text: 'b/' }]);
  });

  it('should fall back to the base settings when the active profile no longer exists', () => {
    const settings = createSettings({ obsidianIgnoreContent: 'a/' });

    const result = resolveProfile({ activeProfileId: 'gone', settings });

    expect(result.activeProfile).toBeNull();
    expect(result.obsidianIgnoreContent).toBe('a/');
  });

  it('should produce no lines for empty base patterns', () => {
    expect(resolveProfile({ activeProfileId: null, settings: createSettings({}) }).lines).toStrictEqual([]);
  });

  it('should append the active profile\'s lines after the base lines', () => {
    const settings = createSettings({ obsidianIgnoreContent: 'base/', profiles: [profile('Work', 'work/\r\n!work/keep.md')] });

    const result = resolveProfile({ activeProfileId: 'work', settings });

    expect(result.activeProfile?.name).toBe('Work');
    expect(result.obsidianIgnoreContent).toBe('base/\nwork/\n!work/keep.md');
    expect(result.lines).toStrictEqual([
      { profileName: null, text: 'base/' },
      { profileName: 'Work', text: 'work/' },
      { profileName: 'Work', text: '!work/keep.md' }
    ]);
  });

  it('should expand imports in reading order, so a later negation re-includes', () => {
    const settings = createSettings({
      profiles: [
        profile('Alpha', 'alpha/'),
        profile('Beta', 'beta/'),
        profile('Gamma', '!alpha/keep.md'),
        profile('Combined', '@import Alpha\n@import  beta  \nown/\n@import Gamma')
      ]
    });

    const result = resolveProfile({ activeProfileId: 'combined', settings });

    expect(result.lines).toStrictEqual([
      { profileName: 'Alpha', text: 'alpha/' },
      { profileName: 'Beta', text: 'beta/' },
      { profileName: 'Combined', text: 'own/' },
      { profileName: 'Gamma', text: '!alpha/keep.md' }
    ]);
    expect(result.errors).toStrictEqual([]);
  });

  it('should inherit every scalar the profiles leave unset', () => {
    const settings = createSettings({
      excludeMode: ExcludeMode.FilesPane,
      profiles: [profile('Work', '')],
      shouldHideEmptyFolders: true,
      shouldIgnoreExcludedFiles: true,
      shouldIncludeGitIgnorePatterns: true
    });

    const result = resolveProfile({ activeProfileId: 'work', settings });

    expect(result.excludeMode).toBe(ExcludeMode.FilesPane);
    expect(result.shouldHideEmptyFolders).toBe(true);
    expect(result.shouldIgnoreExcludedFiles).toBe(true);
    expect(result.shouldIncludeGitIgnorePatterns).toBe(true);
  });

  it('should let a later import win a scalar, and the profile\'s own override beat every import', () => {
    const settings = createSettings({
      profiles: [
        profile('Alpha', '', { excludeMode: ExcludeMode.FilesPane, shouldHideEmptyFolders: true, shouldIncludeGitIgnorePatterns: true }),
        profile('Beta', '', { shouldHideEmptyFolders: false, shouldIgnoreExcludedFiles: true }),
        profile('Combined', '@import Alpha\n@import Beta', { excludeMode: ExcludeMode.Full })
      ]
    });

    const result = resolveProfile({ activeProfileId: 'combined', settings });

    expect(result.excludeMode).toBe(ExcludeMode.Full);
    expect(result.shouldHideEmptyFolders).toBe(false);
    expect(result.shouldIgnoreExcludedFiles).toBe(true);
    expect(result.shouldIncludeGitIgnorePatterns).toBe(true);
  });

  it('should drop the collected lines and scalars at @reset', () => {
    const settings = createSettings({
      excludeMode: ExcludeMode.FilesPane,
      obsidianIgnoreContent: 'base/',
      profiles: [profile('Clean', 'before/\n@reset  \nafter/')],
      shouldHideEmptyFolders: true
    });

    const result = resolveProfile({ activeProfileId: 'clean', settings });

    expect(result.lines).toStrictEqual([{ profileName: 'Clean', text: 'after/' }]);
    expect(result.excludeMode).toBe(ExcludeMode.Full);
    expect(result.shouldHideEmptyFolders).toBe(false);
  });

  it('should keep the own overrides of a profile that resets', () => {
    const settings = createSettings({ profiles: [profile('Clean', '@reset', { shouldHideEmptyFolders: true })] });

    expect(resolveProfile({ activeProfileId: 'clean', settings }).shouldHideEmptyFolders).toBe(true);
  });

  it(String.raw`should read \@ as a literal pattern that starts with @`, () => {
    const settings = createSettings({ profiles: [profile('Work', String.raw`\@import Alpha`)] });

    expect(resolveProfile({ activeProfileId: 'work', settings }).lines).toStrictEqual([{ profileName: 'Work', text: '@import Alpha' }]);
  });

  it('should report an unknown profile, a missing name and an unknown directive, and skip those lines', () => {
    const settings = createSettings({ profiles: [profile('Work', 'a/\n@import Nope\n@import\n@include x\nb/')] });

    const result = resolveProfile({ activeProfileId: 'work', settings });

    expect(result.obsidianIgnoreContent).toBe('a/\nb/');
    expect(result.errors).toStrictEqual([
      { lineNumber: 2, message: 'Unknown profile `Nope`.', profileName: 'Work' },
      { lineNumber: 3, message: '`@import` needs a profile name.', profileName: 'Work' },
      { lineNumber: 4, message: 'Unknown directive `@include x`. Write `\\@` for a pattern that starts with `@`.', profileName: 'Work' }
    ]);
  });

  it('should report an import cycle on the line that closes it', () => {
    const settings = createSettings({
      profiles: [
        profile('Alpha', 'alpha/\n@import Beta'),
        profile('Beta', '@import Alpha\nbeta/')
      ]
    });

    const result = resolveProfile({ activeProfileId: 'alpha', settings });

    expect(result.obsidianIgnoreContent).toBe('alpha/\nbeta/');
    expect(result.errors).toStrictEqual([{ lineNumber: 1, message: 'Import cycle: Alpha → Beta → Alpha.', profileName: 'Beta' }]);
  });

  it('should report an import chain deeper than the limit', () => {
    const profiles = Array.from({ length: MAX_IMPORT_DEPTH + 1 }, (_, index) => profile(`P${String(index)}`, index === MAX_IMPORT_DEPTH ? 'deepest/' : `@import P${String(index + 1)}`));
    const settings = createSettings({ profiles });

    const result = resolveProfile({ activeProfileId: 'p0', settings });

    expect(result.lines).toStrictEqual([]);
    expect(result.errors).toStrictEqual([
      { lineNumber: 1, message: `Imports are nested deeper than ${String(MAX_IMPORT_DEPTH)} profiles.`, profileName: `P${String(MAX_IMPORT_DEPTH - 1)}` }
    ]);
  });
});

describe('findProfileByName', () => {
  it('should match trimmed and case-insensitively', () => {
    const profiles = [profile('Work', '')];

    expect(findProfileByName(profiles, '  work ')).toBe(profiles[0]);
    expect(findProfileByName(profiles, 'home')).toBeUndefined();
  });
});

describe('renameProfileImports', () => {
  it('should rewrite only the imports of the old name', () => {
    expect(renameProfileImports('@import work\n@import Home\nwork/\n\\@import Work', 'Work', 'Office'))
      .toBe('@import Office\n@import Home\nwork/\n\\@import Work');
  });
});

describe('createProfileId', () => {
  it('should create distinct ids without spaces', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.123456789).mockReturnValueOnce(0.987654321);

    const first = createProfileId();
    const second = createProfileId();

    expect(first).not.toBe(second);
    expect(first).not.toContain(' ');
    vi.restoreAllMocks();
  });
});

describe('createUniqueProfileName', () => {
  it('should add the first free numeric suffix', () => {
    const profiles = [profile('New profile', ''), profile('New profile 2', '')];

    expect(createUniqueProfileName(profiles, 'Other')).toBe('Other');
    expect(createUniqueProfileName(profiles, 'New profile')).toBe('New profile 3');
  });
});

describe('duplicateProfile', () => {
  it('should insert a renamed copy after the source', () => {
    const profiles = [profile('Work', 'w/', { shouldHideEmptyFolders: true }), profile('Home', 'h/')];

    const result = duplicateProfile(profiles, 'work');

    expect(result.map((item) => item.name)).toStrictEqual(['Work', 'Work copy', 'Home']);
    expect(result[1]).toMatchObject({ patterns: 'w/', shouldHideEmptyFolders: true });
    expect(result[1]?.id).not.toBe('work');
    expect(profiles).toHaveLength(2);
  });

  it('should return an unchanged copy for an unknown id', () => {
    const profiles = [profile('Work', '')];

    expect(duplicateProfile(profiles, 'nope')).toStrictEqual(profiles);
  });
});

describe('saveProfile', () => {
  it('should append a new profile', () => {
    const profiles = [profile('Work', '')];

    expect(saveProfile(profiles, profile('Home', 'h/'))).toStrictEqual([profile('Work', ''), profile('Home', 'h/')]);
  });

  it('should replace an edited profile without touching the others when the name is kept', () => {
    const profiles = [profile('Work', 'w/'), profile('Home', '@import work')];

    expect(saveProfile(profiles, { id: 'work', name: 'WORK', patterns: 'x/' })).toStrictEqual([
      { id: 'work', name: 'WORK', patterns: 'x/' },
      profile('Home', '@import work')
    ]);
  });

  it('should rewrite the imports of a renamed profile everywhere, its own included', () => {
    const profiles = [profile('Work', '@import Work'), profile('Home', '@import Work\nh/')];

    expect(saveProfile(profiles, { id: 'work', name: 'Office', patterns: '@import Work' })).toStrictEqual([
      { id: 'work', name: 'Office', patterns: '@import Office' },
      profile('Home', '@import Office\nh/')
    ]);
  });
});

describe('isFileImportName', () => {
  it('should tell a file import from a profile name, ignoring case and surrounding spaces', () => {
    expect(isFileImportName(' File:x')).toBe(true);
    expect(isFileImportName('files')).toBe(false);
  });
});
