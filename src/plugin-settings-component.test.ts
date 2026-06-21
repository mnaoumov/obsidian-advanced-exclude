import type { DataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import type { PluginEventSource } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it
} from 'vitest';

import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettings } from './plugin-settings.ts';

describe('PluginSettingsComponent', () => {
  it('should pass PluginSettings class to base constructor', () => {
    const dataHandler = strictProxy<DataHandler>({});
    const pluginEventSource = strictProxy<PluginEventSource>({});

    const component = new PluginSettingsComponent({
      dataHandler,
      pluginEventSource
    });

    expect(component).toBeInstanceOf(PluginSettingsComponent);
    // The real base derives `defaultSettings` from the passed `pluginSettingsClass`.
    expect(component.defaultSettings).toBeInstanceOf(PluginSettings);
  });

  it('should expose settings from base class', () => {
    const dataHandler = strictProxy<DataHandler>({});
    const pluginEventSource = strictProxy<PluginEventSource>({});

    const component = new PluginSettingsComponent({
      dataHandler,
      pluginEventSource
    });

    expect(component.settings).toBeInstanceOf(PluginSettings);
  });
});
