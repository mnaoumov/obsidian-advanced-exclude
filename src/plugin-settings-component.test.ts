import type { DataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import type { PluginEventSource } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettings } from './plugin-settings.ts';

vi.mock('obsidian-dev-utils/obsidian/components/plugin-settings-component', () => {
  class MockPluginSettingsComponentBase {
    public settings: PluginSettings = new PluginSettings();

    public constructor(params: Record<string, unknown>) {
      expect(params['pluginSettingsClass']).toBe(PluginSettings);
    }
  }
  return { PluginSettingsComponentBase: MockPluginSettingsComponentBase };
});

describe('PluginSettingsComponent', () => {
  it('should pass PluginSettings class to base constructor', () => {
    const dataHandler = strictProxy<DataHandler>({});
    const pluginEventSource = strictProxy<PluginEventSource>({});

    const component = new PluginSettingsComponent({
      dataHandler,
      pluginEventSource
    });

    expect(component).toBeInstanceOf(PluginSettingsComponent);
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
