import { AppActiveFileProvider } from 'obsidian-dev-utils/obsidian/active-file-provider';
import { CommandHandlerComponent } from 'obsidian-dev-utils/obsidian/command-handlers/command-handler-component';
import { OpenSettingsCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/open-settings-command-handler';
import { PluginCommandRegistrar } from 'obsidian-dev-utils/obsidian/command-registrar';
import { MenuEventRegistrarComponent } from 'obsidian-dev-utils/obsidian/components/menu-event-registrar-component';
import { PluginSettingsTabComponent } from 'obsidian-dev-utils/obsidian/components/plugin-settings-tab-component';
import { PluginDataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import { PluginBase } from 'obsidian-dev-utils/obsidian/plugin/plugin';
import { PluginEventSourceImpl } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';

import { FileTreeComponent } from './file-tree-component.ts';
import { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import { AdapterPatchComponent } from './patches/adapter-patch-component.ts';
import { FileExplorerViewOnCreatePatchComponent } from './patches/file-explorer-view-on-create-patch-component.ts';
import { VaultLoadPatchComponent } from './patches/vault-load-patch-component.ts';
import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettingsTab } from './plugin-settings-tab.ts';

export class Plugin extends PluginBase {
  protected override onloadImpl(): void {
    const pluginSettingsComponent = this.addChild(
      new PluginSettingsComponent({
        dataHandler: new PluginDataHandler(this),
        pluginEventSource: new PluginEventSourceImpl(this)
      })
    );
    const vaultLoadPatch = this.addChild(new VaultLoadPatchComponent(this.app));

    const ignorePatternsComponent: IgnorePatternsComponent = this.addChild(
      new IgnorePatternsComponent({
        app: this.app,
        onUpdateFileTree: (): Promise<void> => fileTreeComponent.update(),
        pluginSettingsComponent,
        vaultLoadPatch
      })
    );

    const fileTreeComponent = this.addChild(
      new FileTreeComponent({
        app: this.app,
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
      new FileExplorerViewOnCreatePatchComponent({
        app: this.app,
        ignorePatternsComponent,
        pluginSettingsComponent
      })
    );

    this.addChild(
      new AdapterPatchComponent({
        app: this.app,
        fileTreeComponent,
        ignorePatternsComponent,
        pluginSettingsComponent
      })
    );

    const menuEventRegistrar = this.addChild(new MenuEventRegistrarComponent(this.app));
    this.addChild(
      new CommandHandlerComponent({
        activeFileProvider: new AppActiveFileProvider(this.app),
        commandHandlers: [
          new OpenSettingsCommandHandler({
            app: this.app,
            settingTab: pluginSettingsTab
          })
        ],
        commandRegistrar: new PluginCommandRegistrar(this),
        menuEventRegistrar,
        pluginName: this.manifest.name
      })
    );
  }
}
