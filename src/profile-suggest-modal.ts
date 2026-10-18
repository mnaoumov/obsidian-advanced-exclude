import type { App } from 'obsidian';

import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import { FuzzySuggestModal } from 'obsidian';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

export const BASE_SETTINGS_LABEL = 'Base settings';

export interface ProfileChoice {
  /**
  The profile id, or `null` for the base settings.
  */
  readonly id: null | string;
  readonly name: string;
}

/**
 * The "Switch profile..." picker. Choosing an entry makes it the active profile on this device.
 */
export class ProfileSuggestModal extends FuzzySuggestModal<ProfileChoice> {
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(app: App, pluginSettingsComponent: PluginSettingsComponent) {
    super(app);
    this.pluginSettingsComponent = pluginSettingsComponent;
    this.setPlaceholder(`Switch profile (active: ${getActiveProfileLabel(pluginSettingsComponent)})`);
  }

  public override getItems(): ProfileChoice[] {
    return getProfileChoices(this.pluginSettingsComponent);
  }

  public override getItemText(item: ProfileChoice): string {
    return item.name;
  }

  public override onChooseItem(item: ProfileChoice): void {
    invokeAsyncSafely(() => this.pluginSettingsComponent.setActiveProfileId(item.id));
  }
}

/**
 * The label of whatever is in effect on this device: the active profile's name, or {@link BASE_SETTINGS_LABEL}.
 */
export function getActiveProfileLabel(pluginSettingsComponent: PluginSettingsComponent): string {
  return pluginSettingsComponent.effectiveSettings.activeProfile?.name ?? BASE_SETTINGS_LABEL;
}

/**
 * Lists the base settings first, then every profile in the order the settings tab shows them.
 */
export function getProfileChoices(pluginSettingsComponent: PluginSettingsComponent): ProfileChoice[] {
  return [
    { id: null, name: BASE_SETTINGS_LABEL },
    ...pluginSettingsComponent.settings.profiles.map((profile) => ({ id: profile.id, name: profile.name }))
  ];
}
