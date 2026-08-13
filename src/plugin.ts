import { OpenDemoVaultCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/open-demo-vault-command-handler';
import { OpenSettingsCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/open-settings-command-handler';
import { PluginSettingsTabComponent } from 'obsidian-dev-utils/obsidian/components/plugin-settings-tab-component';
import { PluginDataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import { PluginBase } from 'obsidian-dev-utils/obsidian/plugin/plugin';
import { PluginEventSourceImpl } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';

import { FileTreeComponent } from './file-tree-component.ts';
import { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import { IndexProjectionComponent } from './index-projection-component.ts';
import { ManualIndexHider } from './manual-index-hider.ts';
import { AdapterPatchComponent } from './patches/adapter-patch-component.ts';
import { FileExplorerViewOnCreatePatchComponent } from './patches/file-explorer-view-on-create-patch-component.ts';
import { VaultLoadPatchComponent } from './patches/vault-load-patch-component.ts';
import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettingsTab } from './plugin-settings-tab.ts';
import { PublishCompatibilityWarningComponent } from './publish-compatibility-warning-component.ts';
import { RestoreNoticeComponent } from './restore-notice-component.ts';
import { UpdateProgressNoticeComponent } from './update-progress-notice-component.ts';
import { IndexedDatabaseVaultPathStore } from './vault-path-store.ts';

export class Plugin extends PluginBase {
  protected override async onloadImpl(): Promise<void> {
    const pluginSettingsComponent = this.addChild(
      new PluginSettingsComponent({
        dataHandler: new PluginDataHandler(this),
        pluginEventSource: new PluginEventSourceImpl(this)
      })
    );
    this.pluginSettingsComponent = pluginSettingsComponent;
    const vaultLoadPatch = this.addChild(new VaultLoadPatchComponent(this.app));

    // Since obsidian-dev-utils 90 a child is loaded as it is added, so a component's async load tail runs
    // In parallel with the components added after it instead of before them. IgnorePatternsComponent reads
    // The settings while it loads — `loadFingerprint` fingerprints on `shouldIncludeGitIgnorePatterns` and
    // `reload` writes `obsidianIgnoreContent` back — so without this wait it would fingerprint against the
    // Defaults and persist a default-derived state over the stored one.
    await pluginSettingsComponent.loadWithPromises();

    const ignorePatternsComponent: IgnorePatternsComponent = this.addChild(
      new IgnorePatternsComponent({
        app: this.app,
        onUpdateFileTree: (): Promise<void> => indexProjectionComponent.update(),
        pluginSettingsComponent,
        vaultLoadPatch
      })
    );

    const fileTreeComponent = this.addChild(
      new FileTreeComponent({
        app: this.app
      })
    );

    const updateProgressNotice = this.addChild(new UpdateProgressNoticeComponent(this.pluginNoticeComponent));

    // IndexProjectionComponent recomputes the model as it loads, and that reaches into the ignore
    // Patterns component's verdict database, which `loadFingerprint` only opens partway through its own
    // Async load. Without this wait the projection loads first and throws "database is not set", which
    // Fails the whole plugin load. `onUpdateFileTree` below closes over `indexProjectionComponent` but is
    // Only called from `onLayoutReady`/`processConfigChanges`, so awaiting here cannot reach it early.
    await ignorePatternsComponent.loadWithPromises();

    const indexProjectionComponent = this.addChild(
      new IndexProjectionComponent({
        addToFilesPane: fileTreeComponent.addToFilesPane.bind(fileTreeComponent),
        app: this.app,
        deleteFromFilesPane: fileTreeComponent.deleteFromFilesPane.bind(fileTreeComponent),
        ignorePatternsComponent,
        manualIndexHider: new ManualIndexHider(this.app),
        pluginSettingsComponent,
        updateProgressNotice,
        vaultLoadPatch,
        vaultPathStore: new IndexedDatabaseVaultPathStore(this.app.appId)
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
        indexProjectionComponent,
        pluginSettingsComponent
      })
    );

    this.addChild(
      new RestoreNoticeComponent({
        indexProjectionComponent,
        pluginNoticeComponent: this.pluginNoticeComponent
      })
    );

    this.addChild(
      new PublishCompatibilityWarningComponent({
        app: this.app,
        ignorePatternsComponent,
        pluginId: this.manifest.id,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent
      })
    );

    await this.commandHandlerComponent.registerCommandHandlers(() => [
      new OpenSettingsCommandHandler({
        app: this.app,
        settingTab: pluginSettingsTab
      }),
      new OpenDemoVaultCommandHandler({
        app: this.app,
        pluginId: this.manifest.id,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginVersion: this.manifest.version
      })
    ]);
  }
}
