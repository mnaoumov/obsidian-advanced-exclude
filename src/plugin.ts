import type {
  App,
  PluginManifest
} from 'obsidian';

import { PluginDataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import { PluginSettingsTabComponent } from 'obsidian-dev-utils/obsidian/plugin/components/plugin-settings-tab-component';
import { PluginBase } from 'obsidian-dev-utils/obsidian/plugin/plugin';

import { FileTreeComponent } from './file-tree-component.ts';
import { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import { AdapterPatch } from './patches/adapter-patch.ts';
import { FileExplorerViewOnCreatePatch } from './patches/file-explorer-view-on-create-patch.ts';
import { VaultLoadPatch } from './patches/vault-load-patch.ts';
import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettingsTab } from './plugin-settings-tab.ts';

export class Plugin extends PluginBase {
  public constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);

    const pluginSettingsComponent = this.addChild(new PluginSettingsComponent(new PluginDataHandler(this)));
    const vaultLoadPatch = this.addChild(new VaultLoadPatch(app));

    const ignorePatternsComponent: IgnorePatternsComponent = this.addChild(
      new IgnorePatternsComponent({
        app,
        onUpdateFileTree: (): Promise<void> => fileTreeComponent.update(),
        pluginSettingsComponent,
        vaultLoadPatch
      })
    );

    const fileTreeComponent = this.addChild(
      new FileTreeComponent({
        app,
        consoleDebugComponent: this.consoleDebugComponent,
        ignorePatternsComponent,
        pluginSettingsComponent,
        vaultLoadPatch
      })
    );
    this.addChild(
      new PluginSettingsTabComponent({
        plugin: this,
        pluginSettingsTab: new PluginSettingsTab({
          ignorePatternsComponent,
          plugin: this,
          pluginSettingsComponent
        })
      })
    );

    this.addChild(
      new FileExplorerViewOnCreatePatch({
        app,
        ignorePatternsComponent,
        pluginSettingsComponent
      })
    );

    this.addChild(
      new AdapterPatch({
        app,
        fileTreeComponent,
        ignorePatternsComponent,
        pluginSettingsComponent
      })
    );
  }
}
