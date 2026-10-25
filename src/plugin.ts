import { OpenDemoVaultCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/open-demo-vault-command-handler';
import { OpenSettingsCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/open-settings-command-handler';
import { PluginSettingsTabComponent } from '@mnaoumov/obsidian-lib/components/plugin-settings-tab-component';
import { PluginDataHandler } from '@mnaoumov/obsidian-lib/data-handler';
import { PluginBase } from '@mnaoumov/obsidian-lib/plugin/plugin';
import { PluginEventSourceImpl } from '@mnaoumov/obsidian-lib/plugin/plugin-event-source';

import { SwitchProfileCommandHandler } from './command-handlers/switch-profile-command-handler.ts';
import { UseBaseSettingsCommandHandler } from './command-handlers/use-base-settings-command-handler.ts';
import { FileTreeComponent } from './file-tree-component.ts';
import { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import { IndexProjectionComponent } from './index-projection-component.ts';
import { ManualIndexHider } from './manual-index-hider.ts';
import { migrateObsidianIgnoreFile } from './obsidian-ignore-migration.ts';
import { AdapterPatchComponent } from './patches/adapter-patch-component.ts';
import { FileExplorerViewOnCreatePatchComponent } from './patches/file-explorer-view-on-create-patch-component.ts';
import { MetadataCacheInitializePatchComponent } from './patches/metadata-cache-initialize-patch-component.ts';
import { VaultLoadPatchComponent } from './patches/vault-load-patch-component.ts';
import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettingsTab } from './plugin-settings-tab.ts';
import { ProfileSwitcherComponent } from './profile-switcher-component.ts';
import { PublishCompatibilityWarningComponent } from './publish-compatibility-warning-component.ts';
import { RestoreNoticeComponent } from './restore-notice-component.ts';
import { UpdateProgressNoticeComponent } from './update-progress-notice-component.ts';
import { IndexedDatabaseVaultPathStore } from './vault-path-store.ts';

export class Plugin extends PluginBase {
  protected override async onloadImpl(): Promise<void> {
    const pluginSettingsComponent = this.addChild(
      new PluginSettingsComponent({
        app: this.app,
        dataHandler: new PluginDataHandler(this),
        pluginEventSource: new PluginEventSourceImpl(this)
      })
    );
    this.pluginSettingsComponent = pluginSettingsComponent;
    const vaultLoadPatch = this.addChild(new VaultLoadPatchComponent(this.app));
    this.addChild(new MetadataCacheInitializePatchComponent(this.app));

    // A child is loaded as it is added, so a component's async load tail runs
    // in parallel with the components added after it instead of before them. IgnorePatternsComponent reads
    // the settings while it loads — `loadFingerprint` fingerprints on `shouldIncludeGitIgnorePatterns` and
    // the stored patterns — so without this wait it would fingerprint against the defaults and persist a
    // default-derived state over the stored one.
    await pluginSettingsComponent.loadWithPromises();
    // Before the patterns are read: it may copy an existing `.obsidianignore` into the settings.
    await migrateObsidianIgnoreFile({
      app: this.app,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent
    });

    const ignorePatternsComponent: IgnorePatternsComponent = this.addChild(
      new IgnorePatternsComponent({
        app: this.app,
        // Closes over `pluginSettingsTab`, created further down: it is only called from a `saveSettings` handler,
        // and nothing saves the settings before the tab exists.
        isSettingsTabOpen: (): boolean => pluginSettingsTab.isOpen,
        onUpdateFileTree: (): Promise<void> => indexProjectionComponent.update(),
        pluginSettingsComponent
      })
    );

    // Added only once `indexProjectionComponent` exists: its layout-change handler calls into it, and an
    // event during the awaits below would otherwise reach the `const` before it is initialized.
    const fileTreeComponent = new FileTreeComponent({
      app: this.app,
      onFileExplorerViewBuilt: (): void => {
        indexProjectionComponent.reapplyToFilesPane();
      }
    });

    const updateProgressNotice = this.addChild(new UpdateProgressNoticeComponent(this.pluginNoticeComponent));

    // IndexProjectionComponent recomputes the model as it loads, and that reaches into the ignore
    // patterns component's verdict database, which `loadFingerprint` only opens partway through its own
    // async load. Without this wait the projection loads first and throws "database is not set", which
    // fails the whole plugin load. `onUpdateFileTree` below closes over `indexProjectionComponent` but is
    // only called from `onLayoutReady`/`processConfigChanges`, so awaiting here cannot reach it early.
    await ignorePatternsComponent.loadWithPromises();

    const indexProjectionComponent = this.addChild(
      new IndexProjectionComponent({
        addToFilesPane: fileTreeComponent.addToFilesPane.bind(fileTreeComponent),
        app: this.app,
        deleteFromFilesPane: fileTreeComponent.deleteFromFilesPane.bind(fileTreeComponent),
        ignorePatternsComponent,
        manualIndexHider: new ManualIndexHider(this.app),
        pluginSettingsComponent,
        suspendFilesPaneSort: fileTreeComponent.suspendSort.bind(fileTreeComponent),
        updateProgressNotice,
        vaultLoadPatch,
        vaultPathStore: new IndexedDatabaseVaultPathStore(this.app.appId)
      })
    );
    this.addChild(fileTreeComponent);

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

    this.addChild(
      new ProfileSwitcherComponent({
        addStatusBarItem: (): HTMLElement => this.addStatusBarItem(),
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
      }),
      new SwitchProfileCommandHandler({
        app: this.app,
        pluginSettingsComponent
      }),
      new UseBaseSettingsCommandHandler({ pluginSettingsComponent })
    ]);
  }
}
