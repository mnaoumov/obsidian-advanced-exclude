export enum ExcludeMode {
  FilesPane = 'FilesPane',
  Full = 'Full'
}

export class PluginSettings {
  public excludeMode: ExcludeMode = ExcludeMode.Full;
  public obsidianIgnoreContent = '';
  public shouldIgnoreExcludedFiles = false;
  public shouldIncludeGitIgnorePatterns = true;
}
