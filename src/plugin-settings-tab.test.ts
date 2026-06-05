import type { Plugin } from 'obsidian';
import type { PluginSettingsComponentBase } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import type { PluginSettings } from './plugin-settings.ts';

import { PluginSettingsTab } from './plugin-settings-tab.ts';
import { ExcludeMode } from './plugin-settings.ts';

vi.mock('obsidian-dev-utils/html-element', () => ({
  appendCodeBlock: vi.fn()
}));

interface MockPlugin {
  app: App;
}

interface MockPluginSettingsTabBaseParams {
  readonly plugin: MockPlugin;
  readonly pluginSettingsComponent: PluginSettingsComponentBase<PluginSettings>;
}

vi.mock('obsidian-dev-utils/obsidian/plugin/plugin-settings-tab', () => {
  class MockPluginSettingsTabBase {
    public app: App;
    public containerEl: HTMLElement = createDiv();
    protected readonly pluginSettingsComponent: PluginSettingsComponentBase<PluginSettings>;

    public constructor(params: MockPluginSettingsTabBaseParams) {
      this.app = params.plugin.app;
      this.pluginSettingsComponent = params.pluginSettingsComponent;
    }

    public bind(): void {
      // No-op for testing
    }

    public display(): void {
      // No-op for testing
    }

    public async hideAsync(): Promise<void> {
      // No-op for testing
    }
  }

  return {
    PluginSettingsTabBase: MockPluginSettingsTabBase,
    SAVE_TO_FILE_CONTEXT: 'PluginSettingsTab'
  };
});

describe('PluginSettingsTab', () => {
  let app: App;
  let ignorePatternsComponent: IgnorePatternsComponent;
  let pluginSettingsComponent: PluginSettingsComponentBase<PluginSettings>;
  let mockProcessConfigChanges: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let tab: PluginSettingsTab;

  beforeEach(() => {
    app = App.createConfigured__();
    mockProcessConfigChanges = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
      processConfigChanges: mockProcessConfigChanges
    });
    pluginSettingsComponent = strictProxy<PluginSettingsComponentBase<PluginSettings>>({
      settings: {
        excludeMode: ExcludeMode.Full,
        obsidianIgnoreContent: '',
        shouldIgnoreExcludedFiles: false,
        shouldIncludeGitIgnorePatterns: true
      }
    });

    const mockPlugin = strictProxy<Plugin>({});
    Object.defineProperty(mockPlugin, 'app', { value: app.asOriginalType__() });

    tab = new PluginSettingsTab({
      ignorePatternsComponent,
      plugin: mockPlugin,
      pluginSettingsComponent
    });
  });

  describe('display', () => {
    it('should create settings UI elements in containerEl', () => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- Not ready to migrate `display()`.
      tab.display();

      // Display creates 4 Setting elements as children
      expect(tab.containerEl.children.length).toBeGreaterThan(0);
    });
  });

  describe('hideAsync', () => {
    it('should call ignorePatternsComponent.processConfigChanges', async () => {
      await tab.hideAsync();

      expect(mockProcessConfigChanges).toHaveBeenCalled();
    });
  });
});
