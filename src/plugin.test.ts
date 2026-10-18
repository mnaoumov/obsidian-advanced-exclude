import type { PluginManifest } from 'obsidian';

import { ComponentEx } from '@mnaoumov/obsidian-lib/components/component-ex';
import { Component } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { FileTreeComponent } from './file-tree-component.ts';
import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import type { ProfileSwitcherComponent } from './profile-switcher-component.ts';

import { Plugin } from './plugin.ts';

type FileTreeComponentConstructorParams = ConstructorParameters<typeof FileTreeComponent>[0];
type IgnorePatternsComponentConstructorParams = ConstructorParameters<typeof IgnorePatternsComponent>[0];
type ProfileSwitcherComponentConstructorParams = ConstructorParameters<typeof ProfileSwitcherComponent>[0];

/*
 * The real `PluginBase` (from `@mnaoumov/obsidian-lib`) drives the lifecycle here —
 * it is NOT mocked. `await plugin.onload()` registers the base's universal
 * components, runs the plugin's `onloadImpl`, then loads every queued child via
 * the real children-first lifecycle. Each child the plugin adds must therefore
 * be a real loadable `Component`, so every sibling/collaborator stub below
 * returns a real `Component` (carrying only the methods `plugin.ts` calls on it).
 */

// `PluginDataHandler` is NOT stubbed: since obsidian-dev-utils 93.2 the base builds its own settings
// component out of one during `onload` and really calls `dataHandler.loadData()`, which a bare `vi.fn()`
// double does not answer.

vi.mock('@mnaoumov/obsidian-lib/components/plugin-settings-tab-component', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  PluginSettingsTabComponent: vi.fn(function () {
    return new Component();
  })
}));

class MockFileTreeComponent extends Component {
  public addToFilesPane = vi.fn();
  public deleteFromFilesPane = vi.fn();
  public suspendSort = vi.fn();
}

let capturedOnFileExplorerViewBuilt: (() => void) | undefined;
vi.mock('./file-tree-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  FileTreeComponent: vi.fn(function (params: FileTreeComponentConstructorParams) {
    capturedOnFileExplorerViewBuilt = params.onFileExplorerViewBuilt;
    return new MockFileTreeComponent();
  })
}));

const mockReapplyToFilesPane = vi.fn();
const mockUpdate = vi.fn().mockResolvedValue(undefined);

class MockIndexProjectionComponent extends Component {
  public reapplyToFilesPane = mockReapplyToFilesPane;
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

let capturedAddStatusBarItem: (() => HTMLElement) | undefined;
vi.mock('./profile-switcher-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new` and return a real loadable Component.
  ProfileSwitcherComponent: vi.fn(function (params: ProfileSwitcherComponentConstructorParams) {
    capturedAddStatusBarItem = params.addStatusBarItem;
    return new Component();
  })
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

function resetCapturedOnFileExplorerViewBuilt(): void {
  capturedOnFileExplorerViewBuilt = undefined;
}

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
     * The real `PluginBase` adds its universal child components to an internal
     * wrapper component, and that wrapper to itself through the base
     * `Component.addChild`, so none of them reaches the `addChild` override
     * spied on here. Every call it sees is one of the plugin's own 12
     * `onloadImpl` children, which the override routes into the gated
     * feature-surface tier.
     */
    const EXPECTED_ADD_CHILD_CALLS = 12;
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

  it('should register the profile commands', async () => {
    const plugin = new Plugin(app.asOriginalType__(), manifest);
    const addCommandSpy = vi.spyOn(plugin, 'addCommand');
    await plugin.onload();
    expect(addCommandSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'switch-profile' }));
    expect(addCommandSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'use-base-settings' }));
  });

  it('should give the profile switcher a status-bar item of the plugin', async () => {
    const plugin = new Plugin(app.asOriginalType__(), manifest);
    const statusBarItemEl = createDiv();
    const addStatusBarItemSpy = vi.spyOn(plugin, 'addStatusBarItem').mockReturnValue(statusBarItemEl);
    await plugin.onload();

    expect(capturedAddStatusBarItem?.()).toBe(statusBarItemEl);
    expect(addStatusBarItemSpy).toHaveBeenCalledOnce();
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

  it('should wire onFileExplorerViewBuilt callback to indexProjectionComponent.reapplyToFilesPane', async () => {
    resetCapturedOnFileExplorerViewBuilt();
    mockReapplyToFilesPane.mockClear();

    const plugin = new Plugin(app.asOriginalType__(), manifest);
    await plugin.onload();

    capturedOnFileExplorerViewBuilt?.();
    expect(mockReapplyToFilesPane).toHaveBeenCalledOnce();
  });
});
