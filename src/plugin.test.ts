import type {
  App as AppType,
  PluginManifest
} from 'obsidian';

import { Component } from 'obsidian';
import { ensureGenericObject } from 'obsidian-dev-utils/type-guards';
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

import { Plugin } from './plugin.ts';

type IgnorePatternsComponentConstructorParams = ConstructorParameters<typeof IgnorePatternsComponent>[0];

/*
 * The real `PluginBase` (from `obsidian-dev-utils`) drives the lifecycle here —
 * it is NOT mocked. `await plugin.onload()` registers the base's universal
 * components, runs the plugin's `onloadImpl`, then loads every queued child via
 * the real children-first lifecycle. Each child the plugin adds must therefore
 * be a real loadable `Component`, so every sibling/collaborator stub below
 * returns a real `Component` (carrying only the methods `plugin.ts` calls on it).
 */

vi.mock('obsidian-dev-utils/obsidian/data-handler', () => ({
  PluginDataHandler: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/components/plugin-settings-tab-component', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  PluginSettingsTabComponent: vi.fn(function () {
    return new Component();
  })
}));

class MockFileTreeComponent extends Component {
  public addToFilesPane = vi.fn();
  public deleteFromFilesPane = vi.fn();
}

vi.mock('./file-tree-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  FileTreeComponent: vi.fn(function () {
    return new MockFileTreeComponent();
  })
}));

const mockUpdate = vi.fn().mockResolvedValue(undefined);

class MockIndexProjectionComponent extends Component {
  public update = mockUpdate;
}

vi.mock('./index-projection-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  IndexProjectionComponent: vi.fn(function () {
    return new MockIndexProjectionComponent();
  })
}));

let capturedOnUpdateFileTree: (() => Promise<void>) | undefined;
vi.mock('./ignore-patterns-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  IgnorePatternsComponent: vi.fn(function (params: IgnorePatternsComponentConstructorParams) {
    capturedOnUpdateFileTree = params.onUpdateFileTree;
    return new Component();
  })
}));

vi.mock('./patches/adapter-patch-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  AdapterPatchComponent: vi.fn(function () {
    return new Component();
  })
}));

vi.mock('./patches/file-explorer-view-on-create-patch-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  FileExplorerViewOnCreatePatchComponent: vi.fn(function () {
    return new Component();
  })
}));

vi.mock('./patches/vault-load-patch-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  VaultLoadPatchComponent: vi.fn(function () {
    return new Component();
  })
}));

vi.mock('./plugin-settings-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  PluginSettingsComponent: vi.fn(function () {
    return new Component();
  })
}));

vi.mock('./plugin-settings-tab.ts', () => ({
  PluginSettingsTab: vi.fn()
}));

vi.mock('./restore-notice-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  RestoreNoticeComponent: vi.fn(function () {
    return new Component();
  })
}));

vi.mock('./vault-path-store.ts', () => ({
  IndexedDbVaultPathStore: vi.fn()
}));

function resetCapturedOnUpdateFileTree(): void {
  capturedOnUpdateFileTree = undefined;
}

describe('Plugin', () => {
  let app: App;
  let manifest: PluginManifest;
  let savedGlobalApp: AppType;

  beforeEach(() => {
    app = App.createConfigured__();
    const appOriginal = app.asOriginalType__();
    appOriginal.appId = 'test-app-id';

    /*
     * The real base loads `PluginContextComponent` / `PluginNoticeComponent`,
     * which read `obsidianDevUtilsState` off the app (and off the global `app`
     * when resolved implicitly). Seed it on the same holder the base uses.
     */
    ensureGenericObject(appOriginal)['obsidianDevUtilsState'] = {};
    // eslint-disable-next-line @typescript-eslint/dot-notation, @typescript-eslint/no-deprecated -- Test setup: window.app is deprecated but required so implicitly-resolved app lookups share the configured app.
    savedGlobalApp = ensureGenericObject(window)['app'];
    // eslint-disable-next-line @typescript-eslint/dot-notation, @typescript-eslint/no-deprecated -- Test setup: window.app is deprecated but required so implicitly-resolved app lookups share the configured app.
    ensureGenericObject(window)['app'] = appOriginal;

    // Fire layout-ready synchronously so the real lifecycle completes within the test.
    appOriginal.workspace.onLayoutReady = vi.fn((callback: () => void) => {
      callback();
    });

    manifest = {
      author: 'test',
      description: 'test',
      id: 'test-plugin',
      minAppVersion: '0.0.0',
      name: 'Test Plugin',
      version: '1.0.0'
    };
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/dot-notation, @typescript-eslint/no-deprecated -- Test teardown: restoring window.app.
    ensureGenericObject(window)['app'] = savedGlobalApp;
  });

  it('should create plugin and add all children via addChild', async () => {
    const appOriginal = app.asOriginalType__();
    const plugin = new Plugin(appOriginal, manifest);
    await plugin.onload();

    expect(plugin).toBeInstanceOf(Plugin);
    expect(plugin.app).toBe(appOriginal);
    expect(plugin.manifest).toBe(manifest);
  });

  it('should call addChild the expected number of times', async () => {
    /*
     * The real `PluginBase` registers 5 universal child components before
     * `onloadImpl`, then the plugin's `onloadImpl` adds its own 12 children.
     */
    const EXPECTED_BASE_ADD_CHILD_CALLS = 5;
    const EXPECTED_PLUGIN_ADD_CHILD_CALLS = 12;
    const EXPECTED_ADD_CHILD_CALLS = EXPECTED_BASE_ADD_CHILD_CALLS + EXPECTED_PLUGIN_ADD_CHILD_CALLS;
    const appOriginal = app.asOriginalType__();

    // Spy on the real addChild (calls through) so the real children still load.
    const addChildSpy = vi.spyOn(Plugin.prototype, 'addChild');

    const plugin = new Plugin(appOriginal, manifest);
    await plugin.onload();

    expect(addChildSpy).toHaveBeenCalledTimes(EXPECTED_ADD_CHILD_CALLS);

    addChildSpy.mockRestore();
  });

  it('should wire onUpdateFileTree callback to indexProjectionComponent.update', async () => {
    resetCapturedOnUpdateFileTree();
    mockUpdate.mockClear();

    const plugin = new Plugin(app.asOriginalType__(), manifest);
    await plugin.onload();

    expect(capturedOnUpdateFileTree).toBeDefined();
    // Invoke the callback — it should call indexProjectionComponent.update().
    if (capturedOnUpdateFileTree) {
      capturedOnUpdateFileTree().catch(() => undefined);
    }
    expect(mockUpdate).toHaveBeenCalled();
  });
});
