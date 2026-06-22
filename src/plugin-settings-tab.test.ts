import type { Plugin } from 'obsidian';
import type { GenericVoidFunction } from 'obsidian-dev-utils/function';
import type { PluginSettingsComponentBase } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';

import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  App,
  ButtonComponent
} from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';

import { PluginSettingsTab } from './plugin-settings-tab.ts';
import {
  ExcludeMode,
  PluginSettings
} from './plugin-settings.ts';

/*
 * Return-value stub of a dev-utils utility. appendCodeBlock writes into a DOM
 * fragment that the test does not assert on; the real implementation is exercised
 * elsewhere.
 */
vi.mock('obsidian-dev-utils/html-element', () => ({
  appendCodeBlock: vi.fn()
}));

/*
 * Return-value stub of a dev-utils utility. The real base's `bind` duck-types every
 * value component it receives via `getTextBasedComponentValue` -> `isTextBasedComponent`,
 * which READS `setPlaceholderValue` on the component to decide whether it is text-based.
 * The obsidian-test-mocks value components are wrapped in a strict proxy that THROWS on
 * an unmocked property read (a real Obsidian component would yield `undefined` and the
 * probe would simply move on), so the read blows up before `bind` can continue. Stubbing
 * the probe's return value to `null` (its real result for a non-text-based component)
 * lets the REAL base `displayLegacy`/`bind` run end to end over the REAL test-mocks
 * `Setting` controls. This only neutralizes a dev-utils-internal text-placeholder branch
 * that is covered by dev-utils' own tests; the lines under test here merely call
 * `this.bind(...)` and are exercised regardless.
 */
vi.mock('obsidian-dev-utils/obsidian/setting-components/text-based-component', () => ({
  getTextBasedComponentValue: vi.fn(() => null)
}));

describe('PluginSettingsTab', () => {
  let app: App;
  let ignorePatternsComponent: IgnorePatternsComponent;
  let pluginSettingsComponent: PluginSettingsComponentBase<PluginSettings>;
  let saveToFile: ReturnType<typeof vi.fn<typeof noopAsync>>;
  let processConfigChanges: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let tab: PluginSettingsTab;

  beforeEach(() => {
    app = App.createConfigured__();
    saveToFile = vi.fn<typeof noopAsync>(() => noopAsync());
    processConfigChanges = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
      processConfigChanges
    });

    const settings = new PluginSettings();
    settings.excludeMode = ExcludeMode.Full;
    pluginSettingsComponent = strictProxy<PluginSettingsComponentBase<PluginSettings>>({
      defaultSettings: new PluginSettings(),
      on: castTo<PluginSettingsComponentBase<PluginSettings>['on']>(vi.fn((_name: string, _callback: GenericVoidFunction) => ({
        asyncEventSource: {
          offref: vi.fn()
        }
      }))),
      saveToFile,
      setProperty: vi.fn(() => Promise.resolve('')),
      settingsState: {
        effectiveValues: settings,
        inputValues: settings,
        validationMessages: { excludeMode: '', obsidianIgnoreContent: '', shouldIgnoreExcludedFiles: '', shouldIncludeGitIgnorePatterns: '' }
      }
    });

    const plugin = strictProxy<Plugin>({
      app: app.asOriginalType__()
    });

    tab = new PluginSettingsTab({
      ignorePatternsComponent,
      plugin,
      pluginSettingsComponent
    });
  });

  describe('display', () => {
    it('should create settings UI elements in containerEl', () => {
      tab.displayLegacy();

      // Display creates 4 Setting elements as children
      expect(tab.containerEl.children.length).toBeGreaterThan(0);
    });
  });

  describe('Apply button', () => {
    it('should call ignorePatternsComponent.processConfigChanges when clicked', async () => {
      // The test-mock ButtonComponent stores its onClick handler instead of
      // Wiring a real DOM listener, so capture the handlers by button text.
      const handlersByText = new Map<string, (evt: MouseEvent) => unknown>();
      const onClickSpy = vi.spyOn(ButtonComponent.prototype, 'onClick')
        .mockImplementation(function captureOnClick(this: ButtonComponent, callback): ButtonComponent {
          handlersByText.set(this.buttonEl.textContent, callback);
          return this;
        });
      tab.displayLegacy();
      onClickSpy.mockRestore();

      const applyHandler = handlersByText.get('Apply');
      expect(applyHandler).toBeDefined();

      applyHandler?.(new MouseEvent('click'));
      // The onClick is wrapped in convertAsyncToSync; let its microtask settle.
      await noopAsync();

      expect(processConfigChanges).toHaveBeenCalled();
    });
  });

  describe('hideAsync', () => {
    it('should call ignorePatternsComponent.processConfigChanges', async () => {
      await tab.hideAsync();

      expect(saveToFile).toHaveBeenCalled();
      expect(processConfigChanges).toHaveBeenCalled();
    });
  });
});
