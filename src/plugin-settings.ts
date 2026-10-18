export enum ExcludeMode {
  FilesPane = 'FilesPane',
  Full = 'Full'
}

/**
 * A named set of settings that a device can switch to. Its pattern text may import other profiles with
 * `@import <name>` and start over with `@reset` (see `profiles.ts`). A scalar left `undefined` is inherited.
 */
export interface SettingsProfile {
  excludeMode?: ExcludeMode | undefined;
  id: string;
  name: string;
  patterns: string;
  shouldHideEmptyFolders?: boolean | undefined;
  shouldIgnoreExcludedFiles?: boolean | undefined;
  shouldIncludeGitIgnorePatterns?: boolean | undefined;
}

export class PluginSettings {
  public excludeMode: ExcludeMode = ExcludeMode.Full;
  public obsidianIgnoreContent = '';
  public profiles: SettingsProfile[] = [];
  public shouldHideEmptyFolders = false;
  public shouldIgnoreExcludedFiles = false;
  public shouldIncludeGitIgnorePatterns = false;
}
