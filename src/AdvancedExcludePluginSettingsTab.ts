import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsTabBase';

import type { AdvancedExcludePlugin } from './AdvancedExcludePlugin.ts';

export class AdvancedExcludePluginSettingsTab extends PluginSettingsTabBase<AdvancedExcludePlugin> {
  public override display(): void {
    this.containerEl.empty();
  }
}
