import { normalizePath } from 'obsidian';

import type { SettingsProfile } from '../settings/plugin-settings.ts';

import { PluginSettings } from '../settings/plugin-settings.ts';

/**
 * How many profiles deep an `@import` chain may go, counting the active profile as the first. It only bounds a
 * runaway chain; a cycle is reported as a cycle before it gets here.
 */
export const MAX_IMPORT_DEPTH = 10;

/**
 * The prefix that makes an `@import` line import a vault file rather than a profile, so no profile may be named
 * with it.
 */
export const FILE_IMPORT_PREFIX = 'file:';

const IMPORT_DIRECTIVE = '@import';
const IMPORT_DIRECTIVE_REG_EXP = /^@import\s+(?<name>.*\S)\s*$/;
const RESET_DIRECTIVE_REG_EXP = /^@reset\s*$/;
const ID_RADIX = 36;
const ID_RANDOM_PART_START = 2;
const ID_RANDOM_PART_END = 10;
const FIRST_DUPLICATE_NAME_SUFFIX = 2;

export interface EffectiveSettings extends ProfileScalarSettings {
  /**
  The active profile, or `null` when the base settings apply.
  */
  readonly activeProfile: null | Readonly<SettingsProfile>;
  readonly errors: readonly ProfileError[];
  /**
  The expanded pattern text the matcher uses.
  */
  readonly ignorePatterns: string;
  /**
  The normalized vault paths the expansion imports with `@import file:`, each once, in first-import order. They
  depend on the profiles alone, never on the files' contents, so reading them all once is enough to resolve.
  */
  readonly importedFilePaths: readonly string[];
  /**
  The profile whose `@import file:` line first imports each of {@link importedFilePaths}.
  */
  readonly importingProfileNames: ReadonlyMap<string, string>;
  /**
  The expanded pattern lines, each labelled with the profile it came from.
  */
  readonly lines: readonly ResolvedPatternLine[];
}

/**
 * The contents of the vault files an `@import file:` line names, by normalized path: `null` for a file that does not
 * exist. A path missing from the map has not been read yet and expands to nothing, without an error.
 */
export type ImportedFileContents = ReadonlyMap<string, null | string>;

export interface ResolveProfileSettings extends Readonly<ProfileScalarSettings> {
  readonly ignorePatterns: string;
  readonly profiles: readonly Readonly<SettingsProfile>[];
}

interface ExpansionState {
  readonly errors: ProfileError[];
  readonly importedFileContents: ImportedFileContents;
  // Its keys, in insertion order, are the imported paths.
  readonly importingProfileNames: Map<string, string>;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Profile expansion replaces this accumulator when applying directives.
  lines: ResolvedPatternLine[];
  readonly profiles: readonly Readonly<SettingsProfile>[];
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Profile expansion replaces this accumulator when applying directives.
  scalars: ProfileScalarSettings;
}

interface ProfileError {
  /**
  1-based line number in {@link profileName}'s pattern text.
  */
  readonly lineNumber: number;
  readonly message: string;
  readonly profileName: string;
}

type ProfileScalarSettingName = 'excludeMode' | 'shouldHideEmptyFolders' | 'shouldIgnoreExcludedFiles' | 'shouldIncludeGitIgnorePatterns';

type ProfileScalarSettings = Pick<PluginSettings, ProfileScalarSettingName>;

interface ResolvedPatternLine {
  /**
  The vault file the line came from, when {@link profileName} imported it with `@import file:`.
  */
  readonly filePath?: string;
  /**
  The profile the line came from, or `null` for the base settings.
  */
  readonly profileName: null | string;
  readonly text: string;
}

interface ResolveProfileParams {
  readonly activeProfileId: null | string;
  readonly importedFileContents?: ImportedFileContents;
  readonly settings: ResolveProfileSettings;
}

/**
 * Creates an id for a new profile. Ids only have to be unique within one `data.json`, and a profile is
 * referenced by name in pattern text, so this need not be a UUID.
 */
export function createProfileId(): string {
  return `${Date.now().toString(ID_RADIX)}-${Math.random().toString(ID_RADIX).slice(ID_RANDOM_PART_START, ID_RANDOM_PART_END)}`;
}

/**
 * Returns {@link baseName}, or `<baseName> 2`, `<baseName> 3`, ... — the first one no profile uses yet.
 */
export function createUniqueProfileName(profiles: readonly Readonly<SettingsProfile>[], baseName: string): string {
  let name = baseName;
  for (let suffix = FIRST_DUPLICATE_NAME_SUFFIX; findProfileByName(profiles, name); suffix++) {
    name = `${baseName} ${String(suffix)}`;
  }
  return name;
}

/**
 * Returns a copy of {@link profiles} with a copy of the profile {@link profileId} inserted after it, under a new id
 * and a unique name. Returns the list unchanged when there is no such profile.
 */
export function duplicateProfile(profiles: readonly Readonly<SettingsProfile>[], profileId: string): SettingsProfile[] {
  const result = profiles.map((profile) => ({ ...profile }));
  const index = result.findIndex((profile) => profile.id === profileId);
  const source = result[index];
  if (!source) {
    return result;
  }
  result.splice(index + 1, 0, {
    ...source,
    id: createProfileId(),
    name: createUniqueProfileName(result, `${source.name} copy`)
  });
  return result;
}

/**
 * Finds a profile by the name an `@import` line uses: trimmed and case-insensitive.
 */
export function findProfileByName<Profile extends Readonly<SettingsProfile>>(profiles: readonly Profile[], name: string): Profile | undefined {
  const normalizedName = normalizeProfileName(name);
  return profiles.find((profile) => normalizeProfileName(profile.name) === normalizedName);
}

/**
 * Whether {@link name} would be read as a file import rather than a profile name by an `@import` line.
 */
export function isFileImportName(name: string): boolean {
  return normalizeProfileName(name).startsWith(FILE_IMPORT_PREFIX);
}

/**
 * Rewrites every `@import` line naming {@link oldName} to name {@link newName}, so a rename does not break the
 * profiles that import the renamed one.
 */
export function renameProfileImports(patterns: string, oldName: string, newName: string): string {
  const normalizedOldName = normalizeProfileName(oldName);
  return patterns.split('\n').map((line) => {
    const name = IMPORT_DIRECTIVE_REG_EXP.exec(line.trimEnd())?.groups?.['name'];
    return name !== undefined && normalizeProfileName(name) === normalizedOldName ? `${IMPORT_DIRECTIVE} ${newName}` : line;
  }).join('\n');
}

/**
 * Resolves the settings in effect on this device: the base settings, overlaid by the expansion of the active
 * profile.
 *
 * The expansion is linear, as if every imported profile were pasted where its `@import` line sits, so a later
 * `!negation` re-includes what an earlier line hid, exactly as in one `.gitignore`. A profile's own scalar
 * overrides apply after all of its lines, so they beat whatever it imports; once resolved, they sit at its import
 * line in the profile that imports it. `@reset` drops every line collected so far, the base settings' included,
 * and returns every scalar to its default.
 *
 * `@import file:<vault path>` pastes the lines of a vault file, read from `importedFileContents`, the same way. They
 * are taken literally, as in a `.gitignore`: a file cannot import anything.
 *
 * Errors never stop the resolution: the offending line is skipped and reported.
 */
export function resolveProfile(params: ResolveProfileParams): EffectiveSettings {
  const { activeProfileId, importedFileContents = new Map<string, null | string>(), settings } = params;
  const activeProfile = activeProfileId === null ? undefined : settings.profiles.find((profile) => profile.id === activeProfileId);
  const baseScalars = pickScalars(settings);

  if (!activeProfile) {
    return {
      ...baseScalars,
      activeProfile: null,
      errors: [],
      ignorePatterns: settings.ignorePatterns,
      importedFilePaths: [],
      importingProfileNames: new Map(),
      lines: splitLines(settings.ignorePatterns).map((text) => ({ profileName: null, text }))
    };
  }

  const state: ExpansionState = {
    errors: [],
    importedFileContents,
    importingProfileNames: new Map(),
    lines: splitLines(settings.ignorePatterns).map((text) => ({ profileName: null, text })),
    profiles: settings.profiles,
    scalars: baseScalars
  };
  expandProfile(state, activeProfile, [activeProfile]);

  return {
    ...state.scalars,
    activeProfile,
    errors: state.errors,
    ignorePatterns: state.lines.map((line) => line.text).join('\n'),
    importedFilePaths: [...state.importingProfileNames.keys()],
    importingProfileNames: state.importingProfileNames,
    lines: state.lines
  };
}

/**
 * Returns a copy of {@link profiles} with {@link edited} replacing the profile with its id, or appended when it is
 * new. A rename rewrites the `@import` lines of every profile that imported the old name.
 */
export function saveProfile(profiles: readonly Readonly<SettingsProfile>[], edited: Readonly<SettingsProfile>): SettingsProfile[] {
  const previous = profiles.find((profile) => profile.id === edited.id);
  const isRename = previous !== undefined && normalizeProfileName(previous.name) !== normalizeProfileName(edited.name);
  const result = profiles.map((profile) => {
    const copy = profile.id === edited.id ? { ...edited } : { ...profile };
    if (isRename) {
      copy.patterns = renameProfileImports(copy.patterns, previous.name, edited.name);
    }
    return copy;
  });
  if (!previous) {
    result.push({ ...edited });
  }
  return result;
}

/**
 * Expands an `@import file:<path>` line of {@link profile} into {@link state}.
 *
 * @returns The error to report for the line, or `null` when it expanded cleanly.
 */
function expandFileImport(state: ExpansionState, profile: Readonly<SettingsProfile>, rawPath: string): null | string {
  const trimmedPath = rawPath.trim();
  if (trimmedPath === '') {
    return '`@import file:` needs a vault path.';
  }

  const filePath = normalizePath(trimmedPath);
  if (!state.importingProfileNames.has(filePath)) {
    state.importingProfileNames.set(filePath, profile.name);
  }
  // A missing file imports nothing, without an error: an optional per-device file is a normal thing to import.
  const content = state.importedFileContents.get(filePath) ?? '';
  for (const text of splitLines(content)) {
    state.lines.push({ filePath, profileName: profile.name, text });
  }
  return null;
}

/**
 * Expands one line of {@link profile}'s pattern text into {@link state}.
 *
 * @returns The error to report for the line, or `null` when it expanded cleanly.
 */
function expandLine(state: ExpansionState, profile: Readonly<SettingsProfile>, chain: readonly Readonly<SettingsProfile>[], line: string): null | string {
  if (line.startsWith(String.raw`\@`)) {
    state.lines.push({ profileName: profile.name, text: line.slice(1) });
    return null;
  }

  if (!line.startsWith('@')) {
    state.lines.push({ profileName: profile.name, text: line });
    return null;
  }

  const directive = line.trimEnd();
  if (RESET_DIRECTIVE_REG_EXP.test(directive)) {
    state.lines = [];
    state.scalars = pickScalars(new PluginSettings());
    return null;
  }

  const importedName = IMPORT_DIRECTIVE_REG_EXP.exec(directive)?.groups?.['name'];
  if (importedName === undefined) {
    return directive === IMPORT_DIRECTIVE
      ? '`@import` needs a profile name.'
      : `Unknown directive \`${directive}\`. Write \`\\@\` for a pattern that starts with \`@\`.`;
  }

  if (isFileImportName(importedName)) {
    return expandFileImport(state, profile, importedName.trim().slice(FILE_IMPORT_PREFIX.length));
  }

  const importedProfile = findProfileByName(state.profiles, importedName);
  if (!importedProfile) {
    return `Unknown profile \`${importedName}\`.`;
  }

  if (chain.some((chainProfile) => chainProfile.id === importedProfile.id)) {
    const cycleNames = [...chain, importedProfile].map((chainProfile) => chainProfile.name);
    return `Import cycle: ${cycleNames.join(' → ')}.`;
  }

  if (chain.length >= MAX_IMPORT_DEPTH) {
    return `Imports are nested deeper than ${String(MAX_IMPORT_DEPTH)} profiles.`;
  }

  expandProfile(state, importedProfile, [...chain, importedProfile]);
  return null;
}

function expandProfile(state: ExpansionState, profile: Readonly<SettingsProfile>, chain: readonly Readonly<SettingsProfile>[]): void {
  for (const [index, line] of splitLines(profile.patterns).entries()) {
    const errorMessage = expandLine(state, profile, chain, line);
    if (errorMessage !== null) {
      state.errors.push({ lineNumber: index + 1, message: errorMessage, profileName: profile.name });
    }
  }

  state.scalars = {
    excludeMode: profile.excludeMode ?? state.scalars.excludeMode,
    shouldHideEmptyFolders: profile.shouldHideEmptyFolders ?? state.scalars.shouldHideEmptyFolders,
    shouldIgnoreExcludedFiles: profile.shouldIgnoreExcludedFiles ?? state.scalars.shouldIgnoreExcludedFiles,
    shouldIncludeGitIgnorePatterns: profile.shouldIncludeGitIgnorePatterns ?? state.scalars.shouldIncludeGitIgnorePatterns
  };
}

function normalizeProfileName(name: string): string {
  return name.trim().toLowerCase();
}

function pickScalars(settings: Readonly<ProfileScalarSettings>): ProfileScalarSettings {
  return {
    excludeMode: settings.excludeMode,
    shouldHideEmptyFolders: settings.shouldHideEmptyFolders,
    shouldIgnoreExcludedFiles: settings.shouldIgnoreExcludedFiles,
    shouldIncludeGitIgnorePatterns: settings.shouldIncludeGitIgnorePatterns
  };
}

function splitLines(text: string): string[] {
  return text === '' ? [] : text.split(/\r?\n/);
}
