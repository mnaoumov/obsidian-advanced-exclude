import type { DataAdapter } from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  App,
  CapacitorAdapter,
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

import { AdapterPatch } from './adapter-patch.ts';

vi.mock('./file-system-adapter-patch.ts', () => ({
  FileSystemAdapterPatch: vi.fn()
}));

vi.mock('./capacitor-adapter-patch.ts', () => ({
  CapacitorAdapterPatch: vi.fn()
}));

describe('AdapterPatch', () => {
  let ignorePatternsComponent: IgnorePatternsComponent;
  let pluginSettingsComponent: PluginSettingsComponent;
  let fileTreeComponent: FileTreeComponent;

  beforeEach(() => {
    ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({});
    pluginSettingsComponent = strictProxy<PluginSettingsComponent>({});
    fileTreeComponent = strictProxy<FileTreeComponent>({});
  });

  it('should add FileSystemAdapterPatch when adapter is FileSystemAdapter', () => {
    const fsAdapter = FileSystemAdapter.create__('/vault');
    const app = App.createConfigured__({ adapter: fsAdapter.asOriginalType__() });

    const patch = new AdapterPatch({
      app: app.asOriginalType__(),
      fileTreeComponent,
      ignorePatternsComponent,
      pluginSettingsComponent
    });

    const addChildSpy = vi.spyOn(patch, 'addChild');
    patch.onload();

    expect(addChildSpy).toHaveBeenCalledTimes(1);
  });

  it('should add CapacitorAdapterPatch when adapter is CapacitorAdapter', () => {
    const capAdapter = CapacitorAdapter.create__('/vault', {});
    const app = App.createConfigured__({ adapter: capAdapter.asOriginalType__() });

    const patch = new AdapterPatch({
      app: app.asOriginalType__(),
      fileTreeComponent,
      ignorePatternsComponent,
      pluginSettingsComponent
    });

    const addChildSpy = vi.spyOn(patch, 'addChild');
    patch.onload();

    expect(addChildSpy).toHaveBeenCalledTimes(1);
  });

  it('should not add any child when adapter is unknown type', () => {
    const unknownAdapter = strictProxy<DataAdapter>({});
    const app = App.createConfigured__({ adapter: unknownAdapter });

    const patch = new AdapterPatch({
      app: app.asOriginalType__(),
      fileTreeComponent,
      ignorePatternsComponent,
      pluginSettingsComponent
    });

    const addChildSpy = vi.spyOn(patch, 'addChild');
    patch.onload();

    expect(addChildSpy).not.toHaveBeenCalled();
  });
});
