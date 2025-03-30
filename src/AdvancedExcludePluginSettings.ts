import { PluginSettingsBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsBase';

export class AdvancedExcludePluginSettings extends PluginSettingsBase {
  public shouldIgnoreExcludedFiles = true;
  public shouldIncludeGitIgnorePatterns = true;

  public constructor(data: unknown) {
    super();
    this.init(data);
  }
}
