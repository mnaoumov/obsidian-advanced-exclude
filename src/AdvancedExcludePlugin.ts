import { PluginSettingTab } from 'obsidian';
import { EmptySettings } from 'obsidian-dev-utils/obsidian/Plugin/EmptySettings';
import { PluginBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginBase';
import { AdvancedExcludePluginSettingsTab } from './AdvancedExcludePluginSettingsTab.ts';

export class AdvancedExcludePlugin extends PluginBase {
  protected override createPluginSettings(): EmptySettings {
    return new EmptySettings();
  }

  protected override createPluginSettingsTab(): null | PluginSettingTab {
    return new AdvancedExcludePluginSettingsTab(this);
  }

  protected override async onLayoutReady(): Promise<void> {
  }

  protected override onloadComplete(): void {
  }
}
