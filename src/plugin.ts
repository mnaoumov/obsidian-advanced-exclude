import type {
  App,
  PluginManifest
} from 'obsidian';

import { AppActiveFileProvider } from 'obsidian-dev-utils/obsidian/active-file-provider';
import { CommandHandlerComponent } from 'obsidian-dev-utils/obsidian/command-handlers/command-handler-component';
import { OpenSettingsCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/open-settings-command-handler';
import { PluginCommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import { PluginDataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import { AppMenuEventRegistrar } from 'obsidian-dev-utils/obsidian/menu-event-registrar';
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

    const pluginSettingsTab = new PluginSettingsTab({
      ignorePatternsComponent,
      plugin: this,
      pluginSettingsComponent
    });

    this.addChild(
      new PluginSettingsTabComponent({
        plugin: this,
        pluginSettingsTab
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

    this.addChild(
      new CommandHandlerComponent({
        activeFileProvider: new AppActiveFileProvider(app),
        commandHandlers: [
          new OpenSettingsCommandHandler(pluginSettingsTab)
        ],
        commandRegistrar: new PluginCommandRegistrar(this),
        menuEventRegistrar: new AppMenuEventRegistrar(app, this),
        pluginName: this.manifest.name
      })
    );
  }
}
