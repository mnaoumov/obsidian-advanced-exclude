import type { CapacitorFileEntry } from '@obsidian-typings/obsidian-public-latest';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  App,
  CapacitorAdapter
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
import type { IndexProjectionComponent } from '../index-projection-component.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import {
  ExcludeMode,
  PluginSettings
} from '../plugin-settings.ts';
import { CapacitorAdapterPatchComponent } from './capacitor-adapter-patch-component.ts';

interface OnloadAccessor {
  onload(): void;
}

describe('CapacitorAdapterPatchComponent', () => {
  let app: App;
  let settings: PluginSettings;
  let ignorePatternsComponent: IgnorePatternsComponent;
  let indexProjectionComponent: IndexProjectionComponent;
  let pluginSettingsComponent: PluginSettingsComponent;
  let fileTreeComponent: FileTreeComponent;

  beforeEach(() => {
    app = App.createConfigured__();
    settings = new PluginSettings();

    ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
      isIgnored: vi.fn().mockReturnValue(false)
    });
    indexProjectionComponent = strictProxy<IndexProjectionComponent>({
      recordCreate: vi.fn()
    });
    pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
      settings
    });
    fileTreeComponent = strictProxy<FileTreeComponent>({
      deleteFromFilesPane: vi.fn()
    });
  });

  function createAdapter(): ReturnType<typeof CapacitorAdapter.create__> {
    const capAdapter = CapacitorAdapter.create__('/vault', {});
    const adapter = capAdapter.asOriginalType__();
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
    return capAdapter;
  }

  it('should register patches for reconcileFileCreation and reconcileFolderCreation on load', () => {
    const capAdapter = createAdapter();
    const component = new CapacitorAdapterPatchComponent({
      adapter: capAdapter.asOriginalType__(),
      app: app.asOriginalType__(),
      fileTreeComponent,
      ignorePatternsComponent,
      indexProjectionComponent,
      pluginSettingsComponent
    });

    const registerMethodPatchSpy = vi.spyOn(component, 'registerMethodPatch');
    component.load();

    expect(registerMethodPatchSpy).toHaveBeenCalledTimes(2);
  });

  it('should call super.onload', () => {
    const capAdapter = createAdapter();
    const component = new CapacitorAdapterPatchComponent({
      adapter: capAdapter.asOriginalType__(),
      app: app.asOriginalType__(),
      fileTreeComponent,
      ignorePatternsComponent,
      indexProjectionComponent,
      pluginSettingsComponent
    });

    const grandParentProto = Object.getPrototypeOf(Object.getPrototypeOf(component) as object) as OnloadAccessor;
    const superOnloadSpy = vi.spyOn(grandParentProto, 'onload');
    component.load();

    expect(superOnloadSpy).toHaveBeenCalled();
    superOnloadSpy.mockRestore();
  });

  it('should pass isFolder=false for reconcileFileCreation', async () => {
    settings.excludeMode = ExcludeMode.Full;
    vi.mocked(ignorePatternsComponent.isIgnored).mockReturnValue(true);

    const capAdapter = createAdapter();
    const adapter = capAdapter.asOriginalType__();

    const component = new CapacitorAdapterPatchComponent({
      adapter,
      app: app.asOriginalType__(),
      fileTreeComponent,
      ignorePatternsComponent,
      indexProjectionComponent,
      pluginSettingsComponent
    });
    component.load();

    await adapter.reconcileFileCreation('test/file.md', 'test/file.md', strictProxy<CapacitorFileEntry>({}));

    expect(vi.mocked(ignorePatternsComponent.isIgnored)).toHaveBeenCalledWith('test/file.md', false);
  });

  it('should pass isFolder=true for reconcileFolderCreation', async () => {
    const capAdapter = createAdapter();
    const adapter = capAdapter.asOriginalType__();

    const component = new CapacitorAdapterPatchComponent({
      adapter,
      app: app.asOriginalType__(),
      fileTreeComponent,
      ignorePatternsComponent,
      indexProjectionComponent,
      pluginSettingsComponent
    });
    component.load();

    await adapter.reconcileFolderCreation('test/folder', 'test/folder');

    expect(vi.mocked(ignorePatternsComponent.isIgnored)).toHaveBeenCalledWith('test/folder', true);
  });
});
