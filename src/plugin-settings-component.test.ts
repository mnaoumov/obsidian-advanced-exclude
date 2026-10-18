import type { DataHandler } from '@mnaoumov/obsidian-lib/data-handler';
import type { PluginEventSource } from '@mnaoumov/obsidian-lib/plugin/plugin-event-source';
import type { App } from 'obsidian';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  ACTIVE_PROFILE_LOCAL_STORAGE_KEY,
  PluginSettingsComponent
} from './plugin-settings-component.ts';
import {
  ExcludeMode,
  PluginSettings
} from './plugin-settings.ts';

interface CreateComponentResult {
  readonly component: PluginSettingsComponent;
  readonly saveLocalStorage: ReturnType<typeof vi.fn>;
  readonly settings: PluginSettings;
}

describe('PluginSettingsComponent', () => {
  it('should pass PluginSettings class to base constructor', () => {
    const { component } = createComponent(null);

    expect(component).toBeInstanceOf(PluginSettingsComponent);
    // The real base derives `defaultSettings` from the passed `pluginSettingsClass`.
    expect(component.defaultSettings).toBeInstanceOf(PluginSettings);
  });

  it('should expose settings from base class', () => {
    const { component } = createComponent(null);

    expect(component.settings).toBeInstanceOf(PluginSettings);
  });

  it('should read the active profile id from local storage', () => {
    expect(createComponent('work').component.activeProfileId).toBe('work');
    expect(createComponent(null).component.activeProfileId).toBeNull();
    expect(createComponent(42).component.activeProfileId).toBeNull();
  });

  it('should resolve the effective settings from the active profile', () => {
    const { component, settings } = createComponent('work');
    settings.obsidianIgnoreContent = 'base/';
    settings.profiles = [{ excludeMode: ExcludeMode.FilesPane, id: 'work', name: 'Work', patterns: 'work/' }];

    expect(component.effectiveSettings.activeProfile?.id).toBe('work');
    expect(component.effectiveSettings.obsidianIgnoreContent).toBe('base/\nwork/');
    expect(component.effectiveSettings.excludeMode).toBe(ExcludeMode.FilesPane);
  });

  it('should reuse the effective settings until an input changes', () => {
    const { component, settings } = createComponent(null);
    const first = component.effectiveSettings;

    expect(component.effectiveSettings).toBe(first);

    settings.obsidianIgnoreContent = 'changed/';
    const second = component.effectiveSettings;
    expect(second).not.toBe(first);
    expect(second.obsidianIgnoreContent).toBe('changed/');

    for (
      const edit of [
        (): void => {
          settings.excludeMode = ExcludeMode.FilesPane;
        },
        (): void => {
          settings.shouldHideEmptyFolders = true;
        },
        (): void => {
          settings.shouldIgnoreExcludedFiles = true;
        },
        (): void => {
          settings.shouldIncludeGitIgnorePatterns = true;
        },
        (): void => {
          settings.profiles = [];
        }
      ]
    ) {
      const before = component.effectiveSettings;
      edit();
      expect(component.effectiveSettings).not.toBe(before);
    }
  });

  it('should store a new active profile, notify the listeners, and resolve against it', async () => {
    const { component, saveLocalStorage, settings } = createComponent(null);
    settings.profiles = [{ id: 'work', name: 'Work', patterns: '' }];
    expect(component.effectiveSettings.activeProfile).toBeNull();
    const listener = vi.fn();
    const removeListener = component.onActiveProfileChange(listener);

    await component.setActiveProfileId('work');

    expect(saveLocalStorage).toHaveBeenCalledWith(ACTIVE_PROFILE_LOCAL_STORAGE_KEY, 'work');
    expect(listener).toHaveBeenCalledOnce();
    expect(component.activeProfileId).toBe('work');
    expect(component.effectiveSettings.activeProfile?.id).toBe('work');

    removeListener();
    await component.setActiveProfileId(null);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('should do nothing when the active profile does not change', async () => {
    const { component, saveLocalStorage } = createComponent('work');
    const listener = vi.fn();
    component.onActiveProfileChange(listener);

    await component.setActiveProfileId('work');

    expect(saveLocalStorage).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });
});

function createComponent(storedActiveProfileId: unknown): CreateComponentResult {
  const saveLocalStorage = vi.fn();
  const component = new PluginSettingsComponent({
    app: strictProxy<App>({
      loadLocalStorage: vi.fn(() => storedActiveProfileId),
      saveLocalStorage
    }),
    dataHandler: strictProxy<DataHandler>({}),
    pluginEventSource: strictProxy<PluginEventSource>({})
  });
  // The base keeps the effective values in a private state object and hands out that same object from `settings`;
  // tests edit it the way a real edit does, in place.
  const settings = component.settings as PluginSettings;
  return { component, saveLocalStorage, settings };
}
