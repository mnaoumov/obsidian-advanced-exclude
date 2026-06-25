import type { App } from 'obsidian';

import { InternalPluginName } from '@obsidian-typings/obsidian-public-latest/implementations';
import { Notice } from 'obsidian';
import { convertAsyncToSync } from 'obsidian-dev-utils/async';
import { registerAsyncEvent } from 'obsidian-dev-utils/obsidian/components/async-events-component';
import { LayoutReadyComponent } from 'obsidian-dev-utils/obsidian/components/layout-ready-component';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { ExcludeMode } from './plugin-settings.ts';

const NOTICE_DURATION_PERSISTENT_IN_MILLISECONDS = 0;

interface PublishCompatibilityWarningComponentConstructorParams {
  readonly app: App;
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly pluginId: string;
  readonly pluginName: string;
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
  private readonly pluginName: string;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: PublishCompatibilityWarningComponentConstructorParams) {
    super(params.app);
    this.ignorePatternsComponent = params.ignorePatternsComponent;
    this.pluginId = params.pluginId;
    this.pluginName = params.pluginName;
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
      f.createEl('strong', { text: this.pluginName });
      f.createEl('br');
      f.appendText(
        'Obsidian Publish is enabled while Exclude mode is "Full". In Full mode, hidden files are '
          + 'removed from the index, so Publish cannot see them: a file that is already published and is '
          + 'then hidden is detected as deleted and may be removed from your published site. '
          + 'Choose how to resolve this:'
      );
      const buttonsEl = f.createDiv({ cls: 'advanced-exclude-publish-warning-buttons' });
      addButton(buttonsEl, 'Disable Advanced Exclude', convertAsyncToSync(() => this.disableThisPlugin()));
      addButton(buttonsEl, 'Switch to Files Pane mode', convertAsyncToSync(() => this.switchToFilesPaneMode()));
      addButton(buttonsEl, 'Disable Publish', () => {
        this.disablePublishPlugin();
      });
      addButton(buttonsEl, 'Cancel (I am aware of the risks)', () => {
        this.dismiss();
      });
    });

    this.notice = new Notice(fragment, NOTICE_DURATION_PERSISTENT_IN_MILLISECONDS);

    function addButton(containerEl: HTMLElement, text: string, listener: () => void): void {
      containerEl.createEl('button', { text }).addEventListener('click', listener);
    }
  }

  private async switchToFilesPaneMode(): Promise<void> {
    await this.pluginSettingsComponent.setProperty('excludeMode', ExcludeMode.FilesPane);
    await this.ignorePatternsComponent.processConfigChanges();
  }

  private validate(): void {
    const isUnsafe = this.pluginSettingsComponent.settings.excludeMode === ExcludeMode.Full
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
