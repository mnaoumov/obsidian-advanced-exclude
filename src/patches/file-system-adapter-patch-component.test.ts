// eslint-disable-next-line import/no-nodejs-modules, import-x/no-nodejs-modules -- Desktop code.
import type { Stats } from 'node:fs';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  App,
  FileSystemAdapter
} from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { FileTreeComponent } from '../file-tree-component.ts';
import type { IgnorePatternsComponent } from '../ignore-patterns-component.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import {
  ExcludeMode,
  PluginSettings
} from '../plugin-settings.ts';
import { FileSystemAdapterPatchComponent } from './file-system-adapter-patch-component.ts';

describe('FileSystemAdapterPatchComponent', () => {
  let app: App;
  let settings: PluginSettings;
  let ignorePatternsComponent: IgnorePatternsComponent;
  let pluginSettingsComponent: PluginSettingsComponent;
  let fileTreeComponent: FileTreeComponent;

  beforeEach(() => {
    app = App.createConfigured__();
    settings = new PluginSettings();

    ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
      isIgnored: vi.fn().mockReturnValue(false)
    });
    pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
      settings
    });
    fileTreeComponent = strictProxy<FileTreeComponent>({
      deleteFromFilesPane: vi.fn()
    });
  });

  function createComponent(): FileSystemAdapterPatchComponent {
    const fsAdapter = FileSystemAdapter.create__('/vault');
    const adapterOriginal = fsAdapter.asOriginalType__();
    Object.defineProperty(adapterOriginal, 'reconcileFileCreation', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
      writable: true
    });
    Object.defineProperty(adapterOriginal, 'reconcileFolderCreation', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
      writable: true
    });

    return new FileSystemAdapterPatchComponent({
      adapter: adapterOriginal,
      app: app.asOriginalType__(),
      fileTreeComponent,
      ignorePatternsComponent,
      pluginSettingsComponent
    });
  }

  it('should register patches for reconcileFileCreation and reconcileFolderCreation on load', () => {
    const component = createComponent();
    const registerMethodPatchSpy = vi.spyOn(component, 'registerMethodPatch');

    component.load();

    expect(registerMethodPatchSpy).toHaveBeenCalledTimes(2);
  });

  it('should pass isFolder=false for reconcileFileCreation', async () => {
    settings.excludeMode = ExcludeMode.Full;
    vi.mocked(ignorePatternsComponent.isIgnored).mockReturnValue(true);

    const component = createComponent();
    component.load();

    // The reconcileFileCreation patch should pass isFolder=false
    // When ignored with Full mode, it should return early (not call next)
    // We verify through isIgnored being called with isFolder=false
    const fsAdapter = FileSystemAdapter.create__('/vault');
    const adapter = fsAdapter.asOriginalType__();
    Object.defineProperty(adapter, 'reconcileFileCreation', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
      writable: true
    });
    Object.defineProperty(adapter, 'reconcileFolderCreation', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
      writable: true
    });

    const component2 = new FileSystemAdapterPatchComponent({
      adapter,
      app: app.asOriginalType__(),
      fileTreeComponent,
      ignorePatternsComponent,
      pluginSettingsComponent
    });
    component2.load();

    // Trigger the patched reconcileFileCreation
    await adapter.reconcileFileCreation('test/file.md', 'test/file.md', strictProxy<Stats>({}));

    expect(vi.mocked(ignorePatternsComponent.isIgnored)).toHaveBeenCalledWith('test/file.md', false);
  });

  it('should pass isFolder=true for reconcileFolderCreation', async () => {
    const fsAdapter = FileSystemAdapter.create__('/vault');
    const adapter = fsAdapter.asOriginalType__();
    Object.defineProperty(adapter, 'reconcileFileCreation', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
      writable: true
    });
    Object.defineProperty(adapter, 'reconcileFolderCreation', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
      writable: true
    });

    const component = new FileSystemAdapterPatchComponent({
      adapter,
      app: app.asOriginalType__(),
      fileTreeComponent,
      ignorePatternsComponent,
      pluginSettingsComponent
    });
    component.load();

    await adapter.reconcileFolderCreation('test/folder', 'test/folder');

    expect(vi.mocked(ignorePatternsComponent.isIgnored)).toHaveBeenCalledWith('test/folder', true);
  });
});
