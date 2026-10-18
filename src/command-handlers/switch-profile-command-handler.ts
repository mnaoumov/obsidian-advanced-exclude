import type { App } from 'obsidian';

import { GlobalCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/global-command-handler';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { ProfileSuggestModal } from '../profile-suggest-modal.ts';

interface SwitchProfileCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Opens the profile picker. Available once a profile exists.
 */
export class SwitchProfileCommandHandler extends GlobalCommandHandler {
  private readonly app: App;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: SwitchProfileCommandHandlerConstructorParams) {
    super({
      icon: 'layers',
      id: 'switch-profile',
      name: 'Switch profile...'
    });
    this.app = params.app;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  protected override canExecute(): boolean {
    return this.pluginSettingsComponent.settings.profiles.length > 0;
  }

  protected override execute(): void {
    new ProfileSuggestModal(this.app, this.pluginSettingsComponent).open();
  }
}
