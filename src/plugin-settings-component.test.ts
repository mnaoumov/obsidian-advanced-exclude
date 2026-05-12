import type { DataHandler } from 'obsidian-dev-utils/obsidian/data-handler';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it
} from 'vitest';

import { PluginSettingsComponent } from './plugin-settings-component.ts';
import {
  ExcludeMode,
  PluginSettings
} from './plugin-settings.ts';

class TestPluginSettingsComponent extends PluginSettingsComponent {
  public testCreateDefaultSettings(): PluginSettings {
    return this.createDefaultSettings();
  }
}

describe('PluginSettingsComponent', () => {
  it('should create default settings with correct values', () => {
    const dataHandler = strictProxy<DataHandler>({});
    const component = new TestPluginSettingsComponent(dataHandler);
    const settings = component.testCreateDefaultSettings();
    expect(settings).toBeInstanceOf(PluginSettings);
    expect(settings.excludeMode).toBe(ExcludeMode.Full);
    expect(settings.obsidianIgnoreContent).toBe('');
    expect(settings.shouldIgnoreExcludedFiles).toBe(false);
    expect(settings.shouldIncludeGitIgnorePatterns).toBe(true);
  });
});
