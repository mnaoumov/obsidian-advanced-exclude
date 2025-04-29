export enum ExcludeMode {
  FilesPane = 'FilesPane',
  Full = 'Full'
}

export class PluginSettings {
  public excludeMode: ExcludeMode = ExcludeMode.Full;
  public shouldIgnoreExcludedFiles = false;
  public shouldIncludeGitIgnorePatterns = true;
}
