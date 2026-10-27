import { registerAsyncEvent } from '@mnaoumov/obsidian-lib/components/async-events-component';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import {
  Component,
  Menu
} from 'obsidian';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

import {
  getActiveProfileLabel,
  getProfileChoices
} from './profile-suggest-modal.ts';

interface ProfileSwitcherComponentConstructorParams {
  readonly addStatusBarItem: (this: void) => HTMLElement;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * The status-bar item that shows the profile active on this device, and switches it from a menu. It stays hidden
 * until a profile exists, so a vault that uses none sees no change.
 */
export class ProfileSwitcherComponent extends Component {
  private readonly addStatusBarItem: () => HTMLElement;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private statusBarItemEl: HTMLElement | null = null;

  public constructor(params: ProfileSwitcherComponentConstructorParams) {
    super();
    this.addStatusBarItem = params.addStatusBarItem;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  public override onload(): void {
    super.onload();
    const statusBarItemEl = this.addStatusBarItem();
    this.statusBarItemEl = statusBarItemEl;
    statusBarItemEl.addClass('mod-clickable', 'advanced-exclude-profile-status');
    statusBarItemEl.setAttribute('aria-label', 'Switch exclusion profile');
    this.registerDomEvent(statusBarItemEl, 'click', (event_) => {
      this.showMenu(event_);
    });

    const refresh = (): void => {
      this.refresh();
    };
    registerAsyncEvent(this, this.pluginSettingsComponent.on('saveSettings', refresh));
    registerAsyncEvent(this, this.pluginSettingsComponent.on('loadSettings', refresh));
    this.register(this.pluginSettingsComponent.onActiveProfileChange(refresh));
    this.refresh();
  }

  public override onunload(): void {
    this.statusBarItemEl?.remove();
    this.statusBarItemEl = null;
    super.onunload();
  }

  /**
   * Updates the status-bar text and visibility from the current settings.
   */
  public refresh(): void {
    if (!this.statusBarItemEl) {
      return;
    }
    const hasProfiles = this.pluginSettingsComponent.settings.profiles.length > 0;
    this.statusBarItemEl.toggle(hasProfiles);
    this.statusBarItemEl.setText(`Exclude: ${getActiveProfileLabel(this.pluginSettingsComponent)}`);
  }

  private showMenu(event_: MouseEvent): void {
    const menu = new Menu();
    const activeProfileId = this.pluginSettingsComponent.effectiveSettings.activeProfile?.id ?? null;
    for (const choice of getProfileChoices(this.pluginSettingsComponent)) {
      menu.addItem((item) => {
        item
          .setTitle(choice.name)
          .setChecked(choice.id === activeProfileId)
          .onClick(() => {
            invokeAsyncSafely(() => this.pluginSettingsComponent.setActiveProfileId(choice.id));
          });
      });
    }
    menu.showAtMouseEvent(event_);
  }
}
