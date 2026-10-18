import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type {
  App,
  Notice
} from 'obsidian';

import { registerAsyncEvent } from '@mnaoumov/obsidian-lib/components/async-events-component';
import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import { appendCodeBlock } from '@mnaoumov/obsidian-lib/html-element';
import { convertAsyncToSync } from '@mnaoumov/typescript-lib/async';
import { InternalPluginName } from '@obsidian-typings/obsidian-public-latest/implementations';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { ExcludeMode } from './plugin-settings.ts';

interface AddButtonParams {
  readonly containerEl: HTMLElement;
  readonly listener: (this: void) => void;
  readonly text: DocumentFragment | string;
}

interface PublishCompatibilityWarningComponentConstructorParams {
  readonly app: App;
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly pluginId: string;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Warns the user when Obsidian Publish is enabled while the plugin is in `Full`
 * exclude mode — the only unsafe combination. In `Full` mode hidden files are removed
 * from the index, which Publish reads directly: a file that was already published and is
 * then hidden looks deleted to Publish and may be removed from the published site.
 * `Files Pane` mode leaves the index intact and is Publish-safe, so it never warns.
 *
 * The warning is re-evaluated on load, whenever an internal (core) plugin is enabled or
 * disabled (the Publish instance does not implement `onUserEnable`/`onUserDisable`, so the
 * `internalPlugins` `change` event is the reliable hook), and whenever the settings are
 * saved (the exclude mode may have changed).
 */
export class PublishCompatibilityWarningComponent extends LayoutReadyComponent {
  private readonly ignorePatternsComponent: IgnorePatternsComponent;
  private isDismissed = false;
  private notice: Notice | null = null;
  private readonly pluginId: string;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: PublishCompatibilityWarningComponentConstructorParams) {
    super(params.app);
    this.ignorePatternsComponent = params.ignorePatternsComponent;
    this.pluginId = params.pluginId;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  public override onload(): void {
    super.onload();

    this.registerEvent(this.app.internalPlugins.on('change', () => {
      this.validate();
    }));

    registerAsyncEvent(
      this,
      this.pluginSettingsComponent.on('saveSettings', () => {
        this.validate();
      })
    );

    // A profile switch can change the effective exclude mode without saving anything.
    this.register(this.pluginSettingsComponent.onActiveProfileChange(() => {
      this.validate();
    }));
  }

  public override onunload(): void {
    this.hideWarning();
    super.onunload();
  }

  protected override onLayoutReady(): void {
    this.validate();
  }

  private disablePublishPlugin(): void {
    this.app.internalPlugins.getPluginById(InternalPluginName.Publish)?.disable(true);
  }

  private async disableThisPlugin(): Promise<void> {
    await this.app.plugins.disablePluginAndSave(this.pluginId);
  }

  private dismiss(): void {
    this.isDismissed = true;
    this.hideWarning();
  }

  private hideWarning(): void {
    this.notice?.hide();
    this.notice = null;
  }

  private isPublishEnabled(): boolean {
    return this.app.internalPlugins.getEnabledPluginById(InternalPluginName.Publish) !== null;
  }

  private showWarning(): void {
    if (this.notice) {
      return;
    }

    const fragment = createFragment((f) => {
      f.appendText(
        'Obsidian Publish is enabled while Exclude mode is "Full". In Full mode, hidden files are '
          + 'removed from the index, so Publish cannot see them: a file that is already published and is '
          + 'then hidden is detected as deleted and may be removed from your published site. '
          + 'Choose how to resolve this:'
      );
      const buttonsEl = f.createDiv({ cls: 'advanced-exclude-publish-warning-buttons' });
      addButton({
        containerEl: buttonsEl,
        listener: convertAsyncToSync(() => this.disableThisPlugin()),
        text: createFragment((buttonText) => {
          buttonText.appendText('Disable ');
          appendCodeBlock(buttonText, 'Advanced Exclude');
        })
      });
      addButton({ containerEl: buttonsEl, listener: convertAsyncToSync(() => this.switchToFilesPaneMode()), text: 'Switch to Files Pane mode' });
      addButton({
        containerEl: buttonsEl,
        listener: () => {
          this.disablePublishPlugin();
        },
        text: 'Disable Publish'
      });
      addButton({
        containerEl: buttonsEl,
        listener: () => {
          this.dismiss();
        },
        text: 'Cancel (I am aware of the risks)'
      });
    });

    this.notice = this.pluginNoticeComponent.showNotice(fragment, { isPermanent: true });
  }

  private async switchToFilesPaneMode(): Promise<void> {
    // With a profile active, the base mode may be overridden, so the switch goes on the active profile itself: its
    // own setting beats anything it imports. `editAndSave`, not `setProperty`: only a save persists the choice and
    // raises the config change that `processConfigChanges` applies.
    const activeProfileId = this.pluginSettingsComponent.effectiveSettings.activeProfile?.id;
    await this.pluginSettingsComponent.editAndSave((settings) => {
      if (activeProfileId === undefined) {
        settings.excludeMode = ExcludeMode.FilesPane;
        return;
      }
      settings.profiles = settings.profiles.map((profile) => profile.id === activeProfileId ? { ...profile, excludeMode: ExcludeMode.FilesPane } : profile);
    });
    await this.ignorePatternsComponent.processConfigChanges();
  }

  private validate(): void {
    const isUnsafe = this.pluginSettingsComponent.effectiveSettings.excludeMode === ExcludeMode.Full
      && this.isPublishEnabled();

    if (!isUnsafe) {
      this.isDismissed = false;
      this.hideWarning();
      return;
    }

    if (this.isDismissed) {
      return;
    }

    this.showWarning();
  }
}

function addButton(params: AddButtonParams): void {
  const { containerEl, listener, text } = params;
  containerEl.createEl('button', { text }).addEventListener('click', listener);
}
