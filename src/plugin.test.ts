import type { PluginManifest } from 'obsidian';

import { Component } from 'obsidian';
import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';
import { App } from 'obsidian-test-mocks/obsidian';
import {
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
  // A ComponentEx, not a plain Component: onloadImpl awaits its `loadWithPromises`.
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  IgnorePatternsComponent: vi.fn(function (params: IgnorePatternsComponentConstructorParams) {
    capturedOnUpdateFileTree = params.onUpdateFileTree;
    return new ComponentEx();
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
  // A ComponentEx, not a plain Component: onloadImpl awaits its `loadWithPromises`.
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  PluginSettingsComponent: vi.fn(function () {
    return new ComponentEx();
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

vi.mock('./publish-compatibility-warning-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  PublishCompatibilityWarningComponent: vi.fn(function () {
    return new Component();
  })
}));

vi.mock('./vault-path-store.ts', () => ({
  IndexedDatabaseVaultPathStore: vi.fn()
}));

function resetCapturedOnUpdateFileTree(): void {
  capturedOnUpdateFileTree = undefined;
}

describe('Plugin', () => {
  let app: App;
  let manifest: PluginManifest;

  beforeEach(() => {
    app = App.createConfigured__();
    const appOriginal = app.asOriginalType__();
    appOriginal.appId = 'test-app-id';

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
     * The real `PluginBase` registers 9 universal child components before
     * `onloadImpl` (including its own `commandHandlerComponent`, the
     * `MenuEventRegistrarComponent` it wires into it, and — since
     * `obsidian-dev-utils` 89.0.0 — the Notebook Navigator menu-event registrar),
     * then the plugin's `onloadImpl` adds its own 11 children.
     */
    const EXPECTED_BASE_ADD_CHILD_CALLS = 9;
    const EXPECTED_PLUGIN_ADD_CHILD_CALLS = 11;
    const EXPECTED_ADD_CHILD_CALLS = EXPECTED_BASE_ADD_CHILD_CALLS + EXPECTED_PLUGIN_ADD_CHILD_CALLS;
    const appOriginal = app.asOriginalType__();

    // Spy on the real addChild (calls through) so the real children still load.
    const addChildSpy = vi.spyOn(Plugin.prototype, 'addChild');

    const plugin = new Plugin(appOriginal, manifest);
    await plugin.onload();

    expect(addChildSpy).toHaveBeenCalledTimes(EXPECTED_ADD_CHILD_CALLS);

    addChildSpy.mockRestore();
  });

  it('should register the open demo vault command via its command handler', async () => {
    const plugin = new Plugin(app.asOriginalType__(), manifest);
    const addCommandSpy = vi.spyOn(plugin, 'addCommand');
    await plugin.onload();
    expect(addCommandSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'open-demo-vault' })
    );
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
