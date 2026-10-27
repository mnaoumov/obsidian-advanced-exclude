import type { PluginSettingsComponentBase } from '@mnaoumov/obsidian-lib/components/plugin-settings-component';
import type { GenericVoidFunction } from '@mnaoumov/typescript-lib/function';
import type {
  Plugin,
  SettingDefinitionItem,
  SettingGroup
} from 'obsidian';

import { SettingEx } from '@mnaoumov/obsidian-lib/setting-ex';
import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  App,
  ButtonComponent,
  DropdownComponent,
  TextAreaComponent
} from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { IgnorePatternsComponent } from '../patterns/ignore-patterns-component.ts';
import type { ProfileEditModal } from '../profiles/profile-edit-modal.ts';
import type { EffectiveSettings } from '../profiles/profiles.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { resolveProfile } from '../profiles/profiles.ts';
import { PluginSettingsTab } from './plugin-settings-tab.ts';
import {
  ExcludeMode,
  PluginSettings
} from './plugin-settings.ts';

type ProfileEditModalConstructorParams = ConstructorParameters<typeof ProfileEditModal>[0];

const mocks = vi.hoisted(() => ({
  confirm: vi.fn<() => Promise<boolean>>(),
  openedEditors: [] as ProfileEditModalConstructorParams[]
}));

vi.mock('@mnaoumov/obsidian-lib/modals/confirm', () => ({
  confirm: mocks.confirm
}));

vi.mock('../profiles/profile-edit-modal.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new`.
  ProfileEditModal: vi.fn(function (params: ProfileEditModalConstructorParams) {
    mocks.openedEditors.push(params);
    return { open: vi.fn() };
  })
}));

/*
 * Return-value stub of an obsidian-lib utility. appendCodeBlock writes into a DOM
 * fragment that the test does not assert on; the real implementation is exercised
 * elsewhere.
 */
vi.mock('@mnaoumov/typescript-lib/html-element', () => ({
  appendCodeBlock: vi.fn()
}));

interface CapturedDropdown {
  readonly handler: (value: string) => unknown;
  readonly values: string[];
}

/**
 * Renders the rows and captures every button's click handler by its text, in render order. The test-mock
 * `ButtonComponent` stores its handler instead of wiring a DOM listener.
 *
 * @param tab - The settings tab.
 * @returns The handlers by button text.
 */
function captureButtonHandlers(tab: PluginSettingsTab): Map<string, (($event: MouseEvent) => unknown)[]> {
  const handlersByText = new Map<string, (($event: MouseEvent) => unknown)[]>();
  const onClickSpy = vi.spyOn(ButtonComponent.prototype, 'onClick')
    .mockImplementation(function captureOnClick(this: ButtonComponent, callback): ButtonComponent {
      const handlers = handlersByText.get(this.buttonEl.textContent) ?? [];
      handlers.push(callback);
      handlersByText.set(this.buttonEl.textContent, handlers);
      return this;
    });
  renderRows(tab);
  onClickSpy.mockRestore();
  return handlersByText;
}

/**
 * Returns the declared rows, the ones inside a heading group included.
 *
 * @param tab - The settings tab.
 * @returns The rows in render order.
 */
function getRowDefinitions(tab: PluginSettingsTab): SettingDefinitionItem[] {
  return tab.getSettingDefinitions().flatMap((definition) => 'items' in definition ? definition.items : [definition]);
}

/**
 * Invokes every declared row's `render` callback the way Obsidian does when the tab is opened, so the
 * bindings are still exercised now that the rows are declarative.
 *
 * @param tab - The settings tab.
 */
function renderRows(tab: PluginSettingsTab): void {
  for (const definition of getRowDefinitions(tab)) {
    if ('render' in definition) {
      definition.render(new SettingEx(tab.containerEl), castTo<SettingGroup>(null));
    }
  }
}

describe('PluginSettingsTab', () => {
  let app: App;
  let ignorePatternsComponent: IgnorePatternsComponent;
  let activeProfileId: null | string;
  let editAndSave: ReturnType<typeof vi.fn<PluginSettingsComponent['editAndSave']>>;
  let pluginSettingsComponent: PluginSettingsComponent;
  let setActiveProfileId: ReturnType<typeof vi.fn<PluginSettingsComponent['setActiveProfileId']>>;
  let settings: PluginSettings;
  let saveToFile: ReturnType<typeof vi.fn<typeof noopAsync>>;
  let processConfigChanges: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let refreshLocalPatterns: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let scheduleLocalPatternsSave: ReturnType<typeof vi.fn<(text: string) => void>>;
  let tab: PluginSettingsTab;

  beforeEach(() => {
    app = App.createConfigured__();
    saveToFile = vi.fn<typeof noopAsync>(() => noopAsync());
    processConfigChanges = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    refreshLocalPatterns = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    scheduleLocalPatternsSave = vi.fn<(text: string) => void>();
    ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
      getLocalPatternsText: () => '# header\nlocal/',
      processConfigChanges,
      refreshLocalPatterns,
      scheduleLocalPatternsSave
    });

    mocks.openedEditors.length = 0;
    mocks.confirm.mockReset();
    settings = new PluginSettings();
    settings.excludeMode = ExcludeMode.Full;
    settings.profiles = [
      { id: 'work', name: 'Work', patterns: 'drafts/' },
      { id: 'home', name: 'Home', patterns: '@import Work' }
    ];
    activeProfileId = null;
    setActiveProfileId = vi.fn<PluginSettingsComponent['setActiveProfileId']>((profileId) => {
      activeProfileId = profileId;
      return noopAsync();
    });
    editAndSave = vi.fn<PluginSettingsComponent['editAndSave']>(async (editor) => {
      await editor(settings);
    });
    pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
      get activeProfileId(): null | string {
        return activeProfileId;
      },
      defaultSettings: new PluginSettings(),
      editAndSave,
      get effectiveSettings(): EffectiveSettings {
        // Not a plain object: strictProxy caches a plain object a getter returns, which would freeze the first answer.
        return Object.assign(Object.create(null) as EffectiveSettings, resolveProfile({ activeProfileId, settings }));
      },
      importedFileContents: new Map(),
      on: castTo<PluginSettingsComponentBase<PluginSettings>['on']>(vi.fn((_name: string, _callback: GenericVoidFunction) => ({
        asyncEventSource: {
          offref: vi.fn()
        }
      }))),
      saveToFile,
      setActiveProfileId,
      setProperty: vi.fn(() => Promise.resolve('')),
      get settings(): PluginSettings {
        return settings;
      },
      settingsState: {
        effectiveValues: settings,
        inputValues: settings,
        validationMessages: { excludeMode: '', ignorePatterns: '', profiles: '', shouldHideEmptyFolders: '', shouldIgnoreExcludedFiles: '', shouldIncludeGitIgnorePatterns: '' }
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
      renderRows(tab);

      // Rendering the declared rows creates a Setting element per row.
      expect(tab.containerEl.children.length).toBeGreaterThan(0);
    });

    it('should declare the global and local pattern rows, each in its own section, and the options', () => {
      const headings = tab.getSettingDefinitions().map((definition) => 'heading' in definition ? definition.heading : '');
      const names = getRowDefinitions(tab).map((definition) => 'name' in definition ? definition.name : '');

      expect(headings).toStrictEqual([
        'Every device: plugin settings, carried by Obsidian Sync',
        'This device: .obsidianignore, not carried by Obsidian Sync',
        'Options',
        'Profiles'
      ]);
      expect(names).toContain('Global patterns');
      expect(names).toContain('Local patterns');
      expect(names).toContain('Hide empty folders');
      expect(names).not.toContain('Include .obsidianignore patterns');
    });

    it('should show the findings of the global and local patterns under their boxes, taking directives literally', () => {
      settings.ignorePatterns = 'ok/\n@import Work';
      ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
        getLocalPatternsText: () => '# header\nbroken[',
        processConfigChanges,
        refreshLocalPatterns,
        scheduleLocalPatternsSave
      });
      tab = new PluginSettingsTab({ ignorePatternsComponent, plugin: strictProxy<Plugin>({ app: app.asOriginalType__() }), pluginSettingsComponent });

      renderRows(tab);

      const findingsEls = [...tab.containerEl.querySelectorAll('.advanced-exclude-pattern-findings')].filter((el) => el.parentElement?.classList.contains('advanced-exclude-pattern-control') ?? false);
      expect(findingsEls.map((el) => el.textContent))
        .toStrictEqual([
          'Line 2: @import and @reset work only in a profile. Here this line is a pattern for a name that starts with @.',
          String.raw`Line 2: The [ at column 7 is never closed, so this line matches nothing. Write \[ for a bracket.`
        ]);
    });
  });

  describe('Apply button', () => {
    it('should call ignorePatternsComponent.processConfigChanges when clicked', async () => {
      // The test-mock ButtonComponent stores its onClick handler instead of
      // wiring a real DOM listener, so capture the handlers by button text.
      const handlersByText = new Map<string, ($event: MouseEvent) => unknown>();
      const onClickSpy = vi.spyOn(ButtonComponent.prototype, 'onClick')
        .mockImplementation(function captureOnClick(this: ButtonComponent, callback): ButtonComponent {
          handlersByText.set(this.buttonEl.textContent, callback);
          return this;
        });
      renderRows(tab);
      onClickSpy.mockRestore();

      const applyHandler = handlersByText.get('Apply');
      expect(applyHandler).toBeDefined();

      applyHandler?.(new MouseEvent('click'));
      // The onClick is wrapped in convertAsyncToSync; let its microtask settle.
      await noopAsync();

      expect(processConfigChanges).toHaveBeenCalled();
    });
  });

  describe('Profiles', () => {
    it('should switch the active profile on this device from the dropdown', async () => {
      const onChangeHandlers: CapturedDropdown[] = [];
      const onChangeSpy = vi.spyOn(DropdownComponent.prototype, 'onChange')
        .mockImplementation(function captureOnChange(this: DropdownComponent, callback): DropdownComponent {
          onChangeHandlers.push({ handler: callback, values: [...this.selectEl.options].map((option) => option.value) });
          return this;
        });
      renderRows(tab);
      onChangeSpy.mockRestore();

      const activeProfileDropdown = onChangeHandlers.find((entry) => entry.values.includes('base settings'));
      expect(activeProfileDropdown?.values).toStrictEqual(['base settings', 'work', 'home']);

      activeProfileDropdown?.handler('home');
      await noopAsync();
      expect(setActiveProfileId).toHaveBeenLastCalledWith('home');

      activeProfileDropdown?.handler('base settings');
      await noopAsync();
      expect(setActiveProfileId).toHaveBeenLastCalledWith(null);
    });

    it('should open the editor for a new profile with a unique name', () => {
      const handlers = captureButtonHandlers(tab);
      handlers.get('Add profile')?.[0]?.(new MouseEvent('click'));

      expect(mocks.openedEditors[0]?.profile).toMatchObject({ name: 'New profile', patterns: '' });
    });

    it('should save an edited profile and rewrite the imports of a renamed one', async () => {
      const handlers = captureButtonHandlers(tab);
      handlers.get('Edit')?.[0]?.(new MouseEvent('click'));
      const editor = mocks.openedEditors[0];
      expect(editor?.profile.id).toBe('work');

      await editor?.onSave({ id: 'work', name: 'Office', patterns: 'drafts/' });

      expect(settings.profiles).toStrictEqual([
        { id: 'work', name: 'Office', patterns: 'drafts/' },
        { id: 'home', name: 'Home', patterns: '@import Office' }
      ]);
    });

    it('should duplicate a profile', async () => {
      const handlers = captureButtonHandlers(tab);
      handlers.get('Duplicate')?.[0]?.(new MouseEvent('click'));
      await waitForAllAsyncOperations();

      expect(settings.profiles.map((profile) => profile.name)).toStrictEqual(['Work', 'Work copy', 'Home']);
    });

    it('should delete a confirmed profile and fall back to the base settings when it was active', async () => {
      activeProfileId = 'work';
      mocks.confirm.mockResolvedValue(true);
      const handlers = captureButtonHandlers(tab);
      handlers.get('Delete')?.[0]?.(new MouseEvent('click'));
      await waitForAllAsyncOperations();

      expect(setActiveProfileId).toHaveBeenCalledWith(null);
      expect(settings.profiles.map((profile) => profile.id)).toStrictEqual(['home']);
    });

    it('should keep the active profile when deleting another one', async () => {
      activeProfileId = 'home';
      mocks.confirm.mockResolvedValue(true);
      const handlers = captureButtonHandlers(tab);
      handlers.get('Delete')?.[0]?.(new MouseEvent('click'));
      await waitForAllAsyncOperations();

      expect(setActiveProfileId).not.toHaveBeenCalled();
      expect(settings.profiles.map((profile) => profile.id)).toStrictEqual(['home']);
    });

    it('should not delete a profile when the deletion is not confirmed', async () => {
      mocks.confirm.mockResolvedValue(false);
      const handlers = captureButtonHandlers(tab);
      handlers.get('Delete')?.[0]?.(new MouseEvent('click'));
      await waitForAllAsyncOperations();

      expect(editAndSave).not.toHaveBeenCalled();
      expect(settings.profiles).toHaveLength(2);
    });
  });

  describe('Local patterns', () => {
    it('should show .obsidianignore as the component reads it, and hand every edit to it to save', async () => {
      const onChangeHandlers: ((value: string) => unknown)[] = [];
      const onChangeSpy = vi.spyOn(TextAreaComponent.prototype, 'onChange')
        .mockImplementation(function captureOnChange(this: TextAreaComponent, callback): TextAreaComponent {
          onChangeHandlers.push(callback);
          return this;
        });
      renderRows(tab);
      onChangeSpy.mockRestore();

      const textAreas = [...tab.containerEl.querySelectorAll('textarea')];
      expect(textAreas.map((textArea) => textArea.value)).toContain('# header\nlocal/');
      // Rendering re-reads the file, which may have changed with no event for it.
      await waitForAllAsyncOperations();
      expect(refreshLocalPatterns).toHaveBeenCalled();

      // The global row binds its text area through the base; the local row's is the only one with its own handler.
      onChangeHandlers.at(-1)?.('# header\nlocal/\nmore/');
      await waitForAllAsyncOperations();

      expect(scheduleLocalPatternsSave).toHaveBeenCalledWith('# header\nlocal/\nmore/');
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
