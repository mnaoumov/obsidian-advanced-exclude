import type {
  PluginNoticeComponent,
  PluginNoticeComponentShowNoticeOptions
} from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type {
  AsyncEventRef,
  GenericAsyncEventSource
} from '@mnaoumov/typescript-lib/async-events';
import type { Promisable } from 'type-fest';

import { noop } from '@mnaoumov/typescript-lib/function';
import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  Events,
  Notice
} from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { IgnorePatternsComponent } from './patterns/ignore-patterns-component.ts';
import type { EffectiveSettings } from './profiles/profiles.ts';
import type { PluginSettingsComponent } from './settings/plugin-settings-component.ts';

import { resolveProfile } from './profiles/profiles.ts';
import { PublishCompatibilityWarningComponent } from './publish-compatibility-warning-component.ts';
import {
  ExcludeMode,
  PluginSettings
} from './settings/plugin-settings.ts';

const PLUGIN_ID = 'advanced-exclude';

const shownNotices: Notice[] = [];
const showNoticeMock = vi.fn(
  (message: DocumentFragment | string, _options?: PluginNoticeComponentShowNoticeOptions): Notice => {
    const notice = new Notice(message, 0);
    vi.spyOn(notice, 'hide');
    shownNotices.push(notice);
    return notice;
  }
);

interface Harness {
  readonly component: PublishCompatibilityWarningComponent;
  readonly disablePluginAndSave: ReturnType<typeof vi.fn>;
  readonly editAndSave: ReturnType<typeof vi.fn>;
  readonly effectiveSettings: PluginSettings;
  readonly fireActiveProfileChange: () => Promise<void>;
  readonly fireInternalPluginsChange: () => void;
  readonly fireSaveSettings: () => void;
  readonly processConfigChanges: ReturnType<typeof vi.fn>;
  readonly publishDisable: ReturnType<typeof vi.fn>;
  readonly state: HarnessState;
  readonly triggerLayoutReady: () => Promise<void>;
}

interface HarnessState {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The test replaces this mock member while exercising state changes.
  activeProfileId: null | string;
  readonly excludeMode: ExcludeMode;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- The test replaces this mock member while exercising state changes.
  publishEnabled: boolean;
  readonly publishPluginExists: boolean;
}

describe('PublishCompatibilityWarningComponent', () => {
  beforeEach(() => {
    shownNotices.length = 0;
    showNoticeMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not warn when in Files Pane mode even with Publish enabled', () => {
    const harness = createHarness({ excludeMode: ExcludeMode.FilesPane, publishEnabled: true });
    harness.component.load();
    harness.fireSaveSettings();

    expect(shownNotices).toHaveLength(0);
  });

  it('should not warn in Full mode when Publish is disabled', () => {
    const harness = createHarness({ excludeMode: ExcludeMode.Full, publishEnabled: false });
    harness.component.load();
    harness.fireSaveSettings();

    expect(shownNotices).toHaveLength(0);
  });

  it('should warn in Full mode when Publish is enabled', () => {
    const harness = createHarness({ excludeMode: ExcludeMode.Full, publishEnabled: true });
    harness.component.load();
    harness.fireSaveSettings();

    expect(shownNotices).toHaveLength(1);
    expect(showNoticeMock).toHaveBeenCalledWith(expect.any(DocumentFragment), { isPermanent: true });
    const fragment = getFragment(showNoticeMock.mock.calls[0]?.[0]);
    expect(fragment.textContent).toContain('Obsidian Publish is enabled');
    expect(getButtonLabels(fragment)).toStrictEqual([
      'Disable Advanced Exclude',
      'Switch to Files Pane mode',
      'Disable Publish',
      'Cancel (I am aware of the risks)'
    ]);
    expect(getButton(fragment, 'Disable Advanced Exclude').querySelector('code')?.textContent).toBe('Advanced Exclude');
  });

  it('should keep the Disable Advanced Exclude label in one inline span so the flex button keeps its space', () => {
    const harness = createHarness({ excludeMode: ExcludeMode.Full, publishEnabled: true });
    harness.component.load();
    harness.fireSaveSettings();

    const button = getButton(getFragment(showNoticeMock.mock.calls[0]?.[0]), 'Disable Advanced Exclude');
    expect(button.childNodes).toHaveLength(1);
    const label = button.firstElementChild;
    expect(label?.tagName).toBe('SPAN');
    expect(label?.textContent).toBe('Disable Advanced Exclude');
  });

  it('should validate on layout ready', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ excludeMode: ExcludeMode.Full, publishEnabled: true });
    harness.component.load();
    await harness.triggerLayoutReady();

    expect(shownNotices).toHaveLength(1);
  });

  it('should not create a second notice on repeated validation', () => {
    const harness = createHarness({ excludeMode: ExcludeMode.Full, publishEnabled: true });
    harness.component.load();
    harness.fireSaveSettings();
    harness.fireSaveSettings();

    expect(shownNotices).toHaveLength(1);
  });

  it('should hide the warning when Publish becomes disabled', () => {
    const harness = createHarness({ excludeMode: ExcludeMode.Full, publishEnabled: true });
    harness.component.load();
    harness.fireSaveSettings();

    harness.state.publishEnabled = false;
    harness.fireInternalPluginsChange();

    expect(shownNotices[0]?.hide).toHaveBeenCalledTimes(1);
  });

  it('should disable this plugin when the Disable Advanced Exclude button is clicked', async () => {
    const harness = createHarness({ excludeMode: ExcludeMode.Full, publishEnabled: true });
    harness.component.load();
    harness.fireSaveSettings();

    getButton(getFragment(showNoticeMock.mock.calls[0]?.[0]), 'Disable Advanced Exclude').click();
    await waitForAllAsyncOperations();

    expect(harness.disablePluginAndSave).toHaveBeenCalledWith(PLUGIN_ID);
  });

  it('should switch to Files Pane mode when the Switch button is clicked', async () => {
    const harness = createHarness({ excludeMode: ExcludeMode.Full, publishEnabled: true });
    harness.component.load();
    harness.fireSaveSettings();

    getButton(getFragment(showNoticeMock.mock.calls[0]?.[0]), 'Switch to Files Pane mode').click();
    await waitForAllAsyncOperations();

    expect(harness.editAndSave).toHaveBeenCalledTimes(1);
    expect(harness.effectiveSettings.excludeMode).toBe(ExcludeMode.FilesPane);
    expect(harness.processConfigChanges).toHaveBeenCalledTimes(1);
  });

  it('should switch the active profile, not the base settings, to Files Pane mode', async () => {
    const harness = createHarness({ activeProfileId: 'work', excludeMode: ExcludeMode.FilesPane, publishEnabled: true });
    harness.effectiveSettings.profiles = [
      { excludeMode: ExcludeMode.Full, id: 'work', name: 'Work', patterns: '' },
      { id: 'other', name: 'Other', patterns: '' }
    ];
    harness.component.load();
    harness.fireSaveSettings();

    getButton(getFragment(showNoticeMock.mock.calls[0]?.[0]), 'Switch to Files Pane mode').click();
    await waitForAllAsyncOperations();

    expect(harness.effectiveSettings.excludeMode).toBe(ExcludeMode.FilesPane);
    expect(harness.effectiveSettings.profiles).toStrictEqual([
      { excludeMode: ExcludeMode.FilesPane, id: 'work', name: 'Work', patterns: '' },
      { id: 'other', name: 'Other', patterns: '' }
    ]);
    expect(harness.processConfigChanges).toHaveBeenCalledTimes(1);
  });

  it('should revalidate when the active profile changes', async () => {
    const harness = createHarness({ excludeMode: ExcludeMode.FilesPane, publishEnabled: true });
    harness.effectiveSettings.profiles = [{ excludeMode: ExcludeMode.Full, id: 'work', name: 'Work', patterns: '' }];
    harness.component.load();
    harness.fireSaveSettings();
    expect(shownNotices).toHaveLength(0);

    harness.state.activeProfileId = 'work';
    await harness.fireActiveProfileChange();

    expect(shownNotices).toHaveLength(1);
  });

  it('should disable the Publish core plugin when the Disable Publish button is clicked', () => {
    const harness = createHarness({ excludeMode: ExcludeMode.Full, publishEnabled: true });
    harness.component.load();
    harness.fireSaveSettings();

    getButton(getFragment(showNoticeMock.mock.calls[0]?.[0]), 'Disable Publish').click();

    expect(harness.publishDisable).toHaveBeenCalledWith(true);
  });

  it('should not throw when the Publish registration is missing on Disable Publish', () => {
    const harness = createHarness({ excludeMode: ExcludeMode.Full, publishEnabled: true, publishPluginExists: false });
    harness.component.load();
    harness.fireSaveSettings();

    getButton(getFragment(showNoticeMock.mock.calls[0]?.[0]), 'Disable Publish').click();

    expect(harness.publishDisable).not.toHaveBeenCalled();
  });

  it('should dismiss the warning and not re-show it while the unsafe state persists', () => {
    const harness = createHarness({ excludeMode: ExcludeMode.Full, publishEnabled: true });
    harness.component.load();
    harness.fireSaveSettings();

    getButton(getFragment(showNoticeMock.mock.calls[0]?.[0]), 'Cancel (I am aware of the risks)').click();
    expect(shownNotices[0]?.hide).toHaveBeenCalledTimes(1);

    harness.fireSaveSettings();
    expect(shownNotices).toHaveLength(1);
  });

  it('should re-warn after dismissal once the unsafe state clears and returns', () => {
    const harness = createHarness({ excludeMode: ExcludeMode.Full, publishEnabled: true });
    harness.component.load();
    harness.fireSaveSettings();
    getButton(getFragment(showNoticeMock.mock.calls[0]?.[0]), 'Cancel (I am aware of the risks)').click();

    harness.effectiveSettings.excludeMode = ExcludeMode.FilesPane;
    harness.fireSaveSettings();
    harness.effectiveSettings.excludeMode = ExcludeMode.Full;
    harness.fireSaveSettings();

    expect(shownNotices).toHaveLength(2);
  });

  it('should hide the warning on unload', () => {
    const harness = createHarness({ excludeMode: ExcludeMode.Full, publishEnabled: true });
    harness.component.load();
    harness.fireSaveSettings();

    harness.component.unload();

    expect(shownNotices[0]?.hide).toHaveBeenCalledTimes(1);
  });
});

function createAsyncEventRef(): AsyncEventRef {
  return strictProxy<AsyncEventRef>({
    asyncEventSource: strictProxy<GenericAsyncEventSource>({ offref: vi.fn() })
  });
}

function createHarness(overrides?: Partial<HarnessState>): Harness {
  const state: HarnessState = {
    activeProfileId: overrides?.activeProfileId ?? null,
    excludeMode: overrides?.excludeMode ?? ExcludeMode.Full,
    publishEnabled: overrides?.publishEnabled ?? true,
    publishPluginExists: overrides?.publishPluginExists ?? true
  };

  const effectiveSettings = new PluginSettings();
  effectiveSettings.excludeMode = state.excludeMode;

  const app = App.createConfigured__();
  const appOriginal = app.asOriginalType__();

  let layoutReadyCallback: (() => void) | undefined;
  appOriginal.workspace.onLayoutReady = vi.fn().mockImplementation((callback: () => void) => {
    layoutReadyCallback = callback;
  });

  // A real `Events` mints event refs with a real `.e` back-reference, so the component's
  // `registerEvent` cleanup (`ref.e.offref(ref)`) works on unload.
  const internalPluginsEvents = new Events();
  let changeListener: (() => void) | undefined;
  const internalPluginsOn = vi.fn().mockImplementation((name: string, callback: () => void) => {
    if (name === 'change') {
      changeListener = callback;
    }
    return internalPluginsEvents.on(name, callback);
  });

  const publishDisable = vi.fn();
  const publishPlugin = { disable: publishDisable };
  const getEnabledPluginById = vi.fn().mockImplementation(() => (state.publishEnabled ? {} : null));
  const getPluginById = vi.fn().mockImplementation(() => (state.publishPluginExists ? publishPlugin : null));

  appOriginal.internalPlugins = strictProxy<typeof appOriginal.internalPlugins>({
    getEnabledPluginById,
    getPluginById,
    on: internalPluginsOn
  });

  const disablePluginAndSave = vi.fn().mockResolvedValue(undefined);
  appOriginal.plugins = strictProxy<typeof appOriginal.plugins>({ disablePluginAndSave });

  let saveSettingsListener: (() => void) | undefined;
  const settingsOn = vi.fn().mockImplementation((name: string, callback: () => void) => {
    if (name === 'saveSettings') {
      saveSettingsListener = callback;
    }
    return createAsyncEventRef();
  });
  const editAndSave = vi.fn(async (editor: (settings: PluginSettings) => Promisable<void>) => {
    await editor(effectiveSettings);
  });
  let activeProfileChangeListener: (() => Promisable<void>) | undefined;
  const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
    editAndSave,
    get effectiveSettings(): EffectiveSettings {
      // Not a plain object: strictProxy caches a plain object a getter returns, which would freeze the first answer.
      return Object.assign(Object.create(null) as EffectiveSettings, resolveProfile({ activeProfileId: state.activeProfileId, settings: effectiveSettings }));
    },
    on: settingsOn,
    onActiveProfileChange: vi.fn((listener: () => Promisable<void>) => {
      activeProfileChangeListener = listener;
      return noop;
    }),
    settings: effectiveSettings
  });

  const processConfigChanges = vi.fn().mockResolvedValue(undefined);
  const ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({ processConfigChanges });

  const pluginNoticeComponent = strictProxy<PluginNoticeComponent>({ showNotice: showNoticeMock });

  const component = new PublishCompatibilityWarningComponent({
    app: appOriginal,
    ignorePatternsComponent,
    pluginId: PLUGIN_ID,
    pluginNoticeComponent,
    pluginSettingsComponent
  });

  return {
    component,
    disablePluginAndSave,
    editAndSave,
    effectiveSettings,
    fireActiveProfileChange: async (): Promise<void> => {
      await activeProfileChangeListener?.();
    },
    fireInternalPluginsChange: (): void => {
      changeListener?.();
    },
    fireSaveSettings: (): void => {
      saveSettingsListener?.();
    },
    processConfigChanges,
    publishDisable,
    state,
    triggerLayoutReady: async (): Promise<void> => {
      layoutReadyCallback?.();
      await vi.advanceTimersByTimeAsync(0);
    }
  };
}

function getButton(fragment: DocumentFragment, label: string): HTMLButtonElement {
  const button = getButtonElements(fragment).find((candidate) => candidate.textContent === label);
  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }
  return button;
}

function getButtonElements(fragment: DocumentFragment): HTMLButtonElement[] {
  return [...fragment.querySelectorAll('button')];
}

function getButtonLabels(fragment: DocumentFragment): string[] {
  return getButtonElements(fragment).map((button) => button.textContent);
}

function getFragment(message: DocumentFragment | string | undefined): DocumentFragment {
  if (message === undefined || typeof message === 'string') {
    throw new Error('Expected a DocumentFragment message');
  }
  return message;
}
