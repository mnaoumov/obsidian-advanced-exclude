/**
 * Where the Files pane menu's `Exclude` actions write their lines.
 */
export enum ExcludeMenuLayer {
  /**
   * The global patterns of the base settings, which sync.
   */
  Global = 'Global',
  /**
   * `.obsidianignore`, on this device only.
   */
  Local = 'Local'
}

export enum ExcludeMode {
  FilesPane = 'FilesPane',
  Full = 'Full',
  Soft = 'Soft'
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
  public excludeMenuLayer: ExcludeMenuLayer = ExcludeMenuLayer.Global;
  public excludeMode: ExcludeMode = ExcludeMode.Full;
  public ignorePatterns = '';
  public profiles: SettingsProfile[] = [];
  public propertyRules = '';
  public shouldHideEmptyFolders = false;
  public shouldIgnoreExcludedFiles = false;
  public shouldIncludeGitIgnorePatterns = false;
  public shouldSoftExcludeFromGraph = true;
  public shouldSoftExcludeFromOtherFeatures = true;
  public shouldSoftExcludeFromSearch = true;
  public shouldSoftExcludeFromUnlinkedMentions = true;
  /**
   * Patterns soft-excluded in every exclude mode, so one vault can hide some files fully and only soft-exclude others.
   */
  public softIgnorePatterns = '';
}
