import { GlobalCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/global-command-handler';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

interface UseBaseSettingsCommandHandlerConstructorParams {
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Deactivates the profile on this device, so the base settings apply. Available while a profile is active.
 */
export class UseBaseSettingsCommandHandler extends GlobalCommandHandler {
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: UseBaseSettingsCommandHandlerConstructorParams) {
    super({
      icon: 'layers',
      id: 'use-base-settings',
      name: 'Use base settings'
    });
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  protected override canExecute(): boolean {
    return this.pluginSettingsComponent.effectiveSettings.activeProfile !== null;
  }

  protected override async execute(): Promise<void> {
    await this.pluginSettingsComponent.setActiveProfileId(null);
  }
}
