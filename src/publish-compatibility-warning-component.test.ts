import type {
  AsyncEventRef,
  GenericAsyncEventSource
} from 'obsidian-dev-utils/async-events';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentShowNoticeOptions
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import {
  Events,
  Notice
} from 'obsidian';
import { waitForAllAsyncOperations } from 'obsidian-dev-utils/async';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import {
  ExcludeMode,
  PluginSettings
} from './plugin-settings.ts';
import { PublishCompatibilityWarningComponent } from './publish-compatibility-warning-component.ts';

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
  component: PublishCompatibilityWarningComponent;
  disablePluginAndSave: ReturnType<typeof vi.fn>;
  effectiveSettings: PluginSettings;
  fireInternalPluginsChange(): void;
  fireSaveSettings(): void;
  processConfigChanges: ReturnType<typeof vi.fn>;
  publishDisable: ReturnType<typeof vi.fn>;
  setProperty: ReturnType<typeof vi.fn>;
  state: HarnessState;
  triggerLayoutReady(): Promise<void>;
}

interface HarnessState {
  excludeMode: ExcludeMode;
  publishEnabled: boolean;
  publishPluginExists: boolean;
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

    expect(harness.setProperty).toHaveBeenCalledWith('excludeMode', ExcludeMode.FilesPane);
    expect(harness.processConfigChanges).toHaveBeenCalledTimes(1);
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
  const setProperty = vi.fn().mockResolvedValue('');
  const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
    on: settingsOn,
    setProperty,
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
    effectiveSettings,
    fireInternalPluginsChange: (): void => {
      changeListener?.();
    },
    fireSaveSettings: (): void => {
      saveSettingsListener?.();
    },
    processConfigChanges,
    publishDisable,
    setProperty,
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
  return Array.from(fragment.querySelectorAll('button'));
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
