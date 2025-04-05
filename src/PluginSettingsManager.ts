import { PluginSettingsManagerBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsManagerBase';

import { PluginSettings } from './PluginSettings.ts';

export class PluginSettingsManager extends PluginSettingsManagerBase<PluginSettings> {
  protected override createDefaultSettings(): PluginSettings {
    return new PluginSettings();
  }
}
