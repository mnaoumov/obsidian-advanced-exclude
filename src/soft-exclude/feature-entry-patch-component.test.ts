import type { App } from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import { ViewType } from '@obsidian-typings/obsidian-public-latest/implementations';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

import {
  refreshLinkViews,
  refreshSearchViews
} from '../index-projection/refresh-link-views.ts';
import {
  ExcludeMode,
  PluginSettings
} from '../settings/plugin-settings.ts';
import { FeatureEntryPatchComponent } from './feature-entry-patch-component.ts';
import { SoftExcludeFeature } from './feature-scoped-app.ts';

vi.mock('../index-projection/refresh-link-views.ts', () => ({
  refreshLinkViews: vi.fn(),
  refreshSearchViews: vi.fn()
}));

type SettingsListener = () => void;

/*
 * Each fake records the `app` its entry method saw, as a core view does when it starts.
 */
class FakeEngine {
  public seenApps: App[] = [];

  public constructor(public app: App) {}

  public render(): void {
    this.seenApps.push(this.app);
  }
}

class FakeLinkComponent {
  public seenApps: App[] = [];

  public constructor(public app: App) {}

  public recomputeUnlinked(): void {
    this.seenApps.push(this.app);
  }
}

class FakeOutgoingLinkComponent {
  public seenApps: App[] = [];

  public constructor(public app: App) {}

  public recomputeUnlinked(): void {
    this.seenApps.push(this.app);
  }
}

class FakeSearchView {
  public seenApps: App[] = [];

  public constructor(public app: App) {}

  public startSearch(): string {
    this.seenApps.push(this.app);
    return 'started';
  }
}

describe('FeatureEntryPatchComponent', () => {
  let app: App;
  let component: FeatureEntryPatchComponent;
  let leavesByType: Map<string, unknown[]>;
  let scopedApps: Map<SoftExcludeFeature, App>;
  let settings: PluginSettings;
  let settingsListeners: Map<string, SettingsListener>;
  let triggerWorkspaceLayoutReady: (() => void) | undefined;
  let workspaceListeners: Map<string, () => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(refreshLinkViews).mockClear();
    vi.mocked(refreshSearchViews).mockClear();
    leavesByType = new Map();
    workspaceListeners = new Map();
    triggerWorkspaceLayoutReady = undefined;
    app = castTo<App>({
      workspace: {
        getLeavesOfType: (type: string): unknown[] => (leavesByType.get(type) ?? []).map((view) => ({ view })),
        offref: vi.fn(),
        on: (name: string, callback: () => void): object => {
          workspaceListeners.set(name, callback);
          return {};
        },
        onLayoutReady: (callback: () => void): void => {
          triggerWorkspaceLayoutReady = callback;
        }
      }
    });

    settings = new PluginSettings();
    settings.excludeMode = ExcludeMode.Soft;
    settingsListeners = new Map();
    scopedApps = new Map(
      [SoftExcludeFeature.Graph, SoftExcludeFeature.Other, SoftExcludeFeature.Search, SoftExcludeFeature.UnlinkedMentions].map((feature) => [feature, castTo<App>({ feature })])
    );

    component = new FeatureEntryPatchComponent({
      app,
      getFeatureScopedApp: (feature): App => scopedApps.get(feature) ?? app,
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
        effectiveSettings: settings,
        on: castTo<PluginSettingsComponent['on']>(vi.fn((name: string, callback: SettingsListener): object => {
          settingsListeners.set(name, callback);
          return { asyncEventSource: { offref: vi.fn() } };
        })),
        settings
      })
    });
  });

  afterEach(() => {
    component.unload();
    vi.useRealTimers();
  });

  function loadAndFireLayoutReady(): void {
    component.load();
    triggerWorkspaceLayoutReady?.();
    vi.runAllTimers();
  }

  it('runs each entry method with the app of its feature in the soft mode', () => {
    const graphEngine = new FakeEngine(app);
    const localGraphEngine = new FakeEngine(app);
    const backlink = new FakeLinkComponent(app);
    const outgoingLink = new FakeOutgoingLinkComponent(app);
    const searchView = new FakeSearchView(app);
    leavesByType.set(ViewType.Graph, [{ dataEngine: graphEngine }]);
    leavesByType.set(ViewType.LocalGraph, [{ engine: localGraphEngine }]);
    leavesByType.set(ViewType.Backlink, [{ backlink }]);
    leavesByType.set(ViewType.OutgoingLink, [{ outgoingLink }]);
    leavesByType.set(ViewType.Search, [searchView]);
    loadAndFireLayoutReady();
    // The views built before their class was patched re-run once.
    expect(refreshLinkViews).toHaveBeenCalledExactlyOnceWith(app);
    expect(refreshSearchViews).toHaveBeenCalledExactlyOnceWith(app);

    graphEngine.render();
    localGraphEngine.render();
    backlink.recomputeUnlinked();
    outgoingLink.recomputeUnlinked();
    expect(searchView.startSearch()).toBe('started');

    expect(graphEngine.seenApps).toEqual([scopedApps.get(SoftExcludeFeature.Graph)]);
    expect(localGraphEngine.seenApps).toEqual([scopedApps.get(SoftExcludeFeature.Graph)]);
    expect(backlink.seenApps).toEqual([scopedApps.get(SoftExcludeFeature.UnlinkedMentions)]);
    expect(outgoingLink.seenApps).toEqual([scopedApps.get(SoftExcludeFeature.UnlinkedMentions)]);
    expect(searchView.seenApps).toEqual([scopedApps.get(SoftExcludeFeature.Search)]);
    // The swap lasts for the call only.
    expect(graphEngine.app).toBe(app);
    expect(searchView.app).toBe(app);
  });

  it('runs the entry methods unchanged outside the soft mode', () => {
    const graphEngine = new FakeEngine(app);
    leavesByType.set(ViewType.Graph, [{ dataEngine: graphEngine }]);
    settings.excludeMode = ExcludeMode.Full;
    loadAndFireLayoutReady();

    graphEngine.render();

    expect(graphEngine.seenApps).toEqual([app]);
    expect(refreshLinkViews).not.toHaveBeenCalled();
  });

  it('patches backlinks shown in a note, and skips a note without them and deferred leaves', () => {
    const backlinks = new FakeLinkComponent(app);
    leavesByType.set(ViewType.Markdown, [{ backlinks: null }, { backlinks }, {}]);
    leavesByType.set(ViewType.Graph, [{}]);
    leavesByType.set(ViewType.LocalGraph, [{}]);
    leavesByType.set(ViewType.Backlink, [{}]);
    leavesByType.set(ViewType.OutgoingLink, [{}]);
    leavesByType.set(ViewType.Search, [{}]);
    loadAndFireLayoutReady();

    backlinks.recomputeUnlinked();

    expect(backlinks.seenApps).toEqual([scopedApps.get(SoftExcludeFeature.UnlinkedMentions)]);
  });

  it('patches each prototype once, and a view built later on layout-change or file-open', () => {
    loadAndFireLayoutReady();
    const first = new FakeEngine(app);
    leavesByType.set(ViewType.Graph, [{ dataEngine: first }, { dataEngine: new FakeEngine(app) }]);
    workspaceListeners.get('layout-change')?.();
    const backlinks = new FakeLinkComponent(app);
    leavesByType.set(ViewType.Markdown, [{ backlinks }]);
    workspaceListeners.get('file-open')?.();
    expect(refreshLinkViews).toHaveBeenCalledTimes(2);
    workspaceListeners.get('layout-change')?.();
    expect(refreshLinkViews).toHaveBeenCalledTimes(2);

    first.render();
    backlinks.recomputeUnlinked();

    // A second patch of the same prototype would have nested the swap; the restore then still leaves the real app.
    expect(first.seenApps).toEqual([scopedApps.get(SoftExcludeFeature.Graph)]);
    expect(first.app).toBe(app);
    expect(backlinks.seenApps).toEqual([scopedApps.get(SoftExcludeFeature.UnlinkedMentions)]);
  });

  it('restores the prototypes on unload', () => {
    const graphEngine = new FakeEngine(app);
    leavesByType.set(ViewType.Graph, [{ dataEngine: graphEngine }]);
    loadAndFireLayoutReady();
    component.unload();

    graphEngine.render();

    expect(graphEngine.seenApps).toEqual([app]);
  });

  it('refreshes the views when a toggle changes in the soft mode', () => {
    loadAndFireLayoutReady();

    settingsListeners.get('saveSettings')?.();
    expect(refreshLinkViews).not.toHaveBeenCalled();

    settings.shouldSoftExcludeFromGraph = false;
    settingsListeners.get('loadSettings')?.();
    expect(refreshLinkViews).toHaveBeenCalledWith(app);
    expect(refreshSearchViews).toHaveBeenCalledWith(app);

    settingsListeners.get('saveSettings')?.();
    expect(refreshLinkViews).toHaveBeenCalledOnce();
  });

  it('does not refresh the views for a toggle changed outside the soft mode', () => {
    loadAndFireLayoutReady();
    settings.excludeMode = ExcludeMode.Full;
    settings.shouldSoftExcludeFromSearch = false;

    settingsListeners.get('saveSettings')?.();

    expect(refreshLinkViews).not.toHaveBeenCalled();
    expect(refreshSearchViews).not.toHaveBeenCalled();
  });
});
