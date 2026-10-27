export enum ExcludeMode {
  FilesPane = 'FilesPane',
  Full = 'Full'
}

/**
 * A named set of settings that a device can switch to. Its pattern text may import other profiles with
 * `@import <name>` and start over with `@reset` (see `profiles.ts`). A scalar left `undefined` is inherited.
 */
export interface SettingsProfile {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The profile editor updates this setting in place before saving.
  excludeMode?: ExcludeMode | undefined;
  readonly id: string;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The profile editor updates this setting in place before saving.
  name: string;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The profile editor updates this setting in place before saving.
  patterns: string;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The profile editor updates this setting in place before saving.
  shouldHideEmptyFolders?: boolean | undefined;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The profile editor updates this setting in place before saving.
  shouldIgnoreExcludedFiles?: boolean | undefined;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The profile editor updates this setting in place before saving.
  shouldIncludeGitIgnorePatterns?: boolean | undefined;
}

export class PluginSettings {
  public excludeMode: ExcludeMode = ExcludeMode.Full;
  public ignorePatterns = '';
  public profiles: SettingsProfile[] = [];
  public shouldHideEmptyFolders = false;
  public shouldIgnoreExcludedFiles = false;
  public shouldIncludeGitIgnorePatterns = false;
}
