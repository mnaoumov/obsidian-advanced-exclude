import type { DataAdapterEx } from '@obsidian-typings/obsidian-public-latest';
import type {
  Component,
  DataAdapter
} from 'obsidian';

import { getDataAdapterEx } from '@obsidian-typings/obsidian-public-latest/implementations';
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
import type { IndexProjectionComponent } from '../index-projection-component.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { AdapterPatchComponent } from './adapter-patch-component.ts';

vi.mock('@obsidian-typings/obsidian-public-latest/implementations', () => ({
  getDataAdapterEx: vi.fn()
}));

function createMockComponent(): Pick<Component, 'load'> {
  return { load: vi.fn() };
}

vi.mock('./file-system-adapter-patch-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new`
  FileSystemAdapterPatchComponent: vi.fn().mockImplementation(function () {
    return createMockComponent();
  })
}));

vi.mock('./capacitor-adapter-patch-component.ts', () => ({
  // eslint-disable-next-line prefer-arrow-callback, func-names -- mock must be constructable with `new`
  CapacitorAdapterPatchComponent: vi.fn().mockImplementation(function () {
    return createMockComponent();
  })
}));

const mockGetDataAdapterEx = vi.mocked(getDataAdapterEx);

function createMockDataAdapterEx(): DataAdapterEx {
  return strictProxy<DataAdapterEx>({
    reconcileDeletion: vi.fn()
  });
}

describe('AdapterPatchComponent', () => {
  let ignorePatternsComponent: IgnorePatternsComponent;
  let indexProjectionComponent: IndexProjectionComponent;
  let pluginSettingsComponent: PluginSettingsComponent;
  let fileTreeComponent: FileTreeComponent;

  beforeEach(() => {
    ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({});
    indexProjectionComponent = strictProxy<IndexProjectionComponent>({
      isApplyingProjection: false,
      recordCreate: vi.fn(),
      recordDelete: vi.fn()
    });
    pluginSettingsComponent = strictProxy<PluginSettingsComponent>({});
    fileTreeComponent = strictProxy<FileTreeComponent>({});
    mockGetDataAdapterEx.mockReturnValue(strictProxy(createMockDataAdapterEx()));
  });

  it('should add FileSystemAdapterPatchComponent when adapter is FileSystemAdapter', () => {
    const fsAdapter = FileSystemAdapter.create__('/vault');
    const app = App.createConfigured__({ adapter: fsAdapter.asOriginalType__() });

    const patch = new AdapterPatchComponent({
      app: app.asOriginalType__(),
      fileTreeComponent,
      ignorePatternsComponent,
      indexProjectionComponent,
      pluginSettingsComponent
    });

    const addChildSpy = vi.spyOn(patch, 'addChild');
    patch.load();

    expect(addChildSpy).toHaveBeenCalledTimes(1);
  });

  it('should add CapacitorAdapterPatchComponent when adapter is CapacitorAdapter', () => {
    const capAdapter = CapacitorAdapter.create__('/vault', {});
    const app = App.createConfigured__({ adapter: capAdapter.asOriginalType__() });

    const patch = new AdapterPatchComponent({
      app: app.asOriginalType__(),
      fileTreeComponent,
      ignorePatternsComponent,
      indexProjectionComponent,
      pluginSettingsComponent
    });

    const addChildSpy = vi.spyOn(patch, 'addChild');
    patch.load();

    expect(addChildSpy).toHaveBeenCalledTimes(1);
  });

  it('should not add any child when adapter is unknown type', () => {
    const unknownAdapter = strictProxy<DataAdapter>({});
    const app = App.createConfigured__({ adapter: unknownAdapter });

    const patch = new AdapterPatchComponent({
      app: app.asOriginalType__(),
      fileTreeComponent,
      ignorePatternsComponent,
      indexProjectionComponent,
      pluginSettingsComponent
    });

    const addChildSpy = vi.spyOn(patch, 'addChild');
    patch.load();

    expect(addChildSpy).not.toHaveBeenCalled();
  });

  describe('reconcileDeletion', () => {
    it('should call fallback and handleDeletedOrDotFile when layout is ready', async () => {
      const mockHandleDeletedOrDotFile = vi.fn().mockResolvedValue(undefined);
      ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
        handleDeletedOrDotFile: mockHandleDeletedOrDotFile
      });

      const unknownAdapter = strictProxy<DataAdapter>({});
      const app = App.createConfigured__({ adapter: unknownAdapter });
      const appOriginal = app.asOriginalType__();
      Object.defineProperty(appOriginal.workspace, 'layoutReady', { configurable: true, value: true });

      const mockDataAdapterEx = createMockDataAdapterEx();
      mockGetDataAdapterEx.mockReturnValue(strictProxy(mockDataAdapterEx));

      const patch = new AdapterPatchComponent({
        app: appOriginal,
        fileTreeComponent,
        ignorePatternsComponent,
        indexProjectionComponent,
        pluginSettingsComponent
      });

      patch.load();

      // Call through the patched object to cover the patchHandler lambda
      await mockDataAdapterEx.reconcileDeletion('test/path', 'test/path');

      expect(vi.mocked(indexProjectionComponent.recordDelete)).toHaveBeenCalledWith('test/path');
      expect(mockHandleDeletedOrDotFile).toHaveBeenCalledWith('test/path');
    });

    it('should not call handleDeletedOrDotFile when layout is not ready', async () => {
      const mockHandleDeletedOrDotFile = vi.fn().mockResolvedValue(undefined);
      ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
        handleDeletedOrDotFile: mockHandleDeletedOrDotFile
      });

      const unknownAdapter = strictProxy<DataAdapter>({});
      const app = App.createConfigured__({ adapter: unknownAdapter });
      const appOriginal = app.asOriginalType__();
      Object.defineProperty(appOriginal.workspace, 'layoutReady', { configurable: true, value: false });

      const mockDataAdapterEx = createMockDataAdapterEx();
      mockGetDataAdapterEx.mockReturnValue(strictProxy(mockDataAdapterEx));

      const patch = new AdapterPatchComponent({
        app: appOriginal,
        fileTreeComponent,
        ignorePatternsComponent,
        indexProjectionComponent,
        pluginSettingsComponent
      });

      patch.load();

      // Call through the patched object to cover the patchHandler lambda
      await mockDataAdapterEx.reconcileDeletion('test/path', 'test/path');

      expect(vi.mocked(indexProjectionComponent.recordDelete)).not.toHaveBeenCalled();
      expect(mockHandleDeletedOrDotFile).not.toHaveBeenCalled();
    });

    it('should not record the deletion while the projection is applying its own hides', async () => {
      const mockHandleDeletedOrDotFile = vi.fn().mockResolvedValue(undefined);
      ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
        handleDeletedOrDotFile: mockHandleDeletedOrDotFile
      });
      indexProjectionComponent = strictProxy<IndexProjectionComponent>({
        isApplyingProjection: true,
        recordDelete: vi.fn()
      });

      const unknownAdapter = strictProxy<DataAdapter>({});
      const app = App.createConfigured__({ adapter: unknownAdapter });
      const appOriginal = app.asOriginalType__();
      Object.defineProperty(appOriginal.workspace, 'layoutReady', { configurable: true, value: true });

      const mockDataAdapterEx = createMockDataAdapterEx();
      mockGetDataAdapterEx.mockReturnValue(strictProxy(mockDataAdapterEx));

      const patch = new AdapterPatchComponent({
        app: appOriginal,
        fileTreeComponent,
        ignorePatternsComponent,
        indexProjectionComponent,
        pluginSettingsComponent
      });

      patch.load();

      // Call through the patched object to cover the patchHandler lambda
      await mockDataAdapterEx.reconcileDeletion('test/path', 'test/path');

      expect(vi.mocked(indexProjectionComponent.recordDelete)).not.toHaveBeenCalled();
      expect(mockHandleDeletedOrDotFile).not.toHaveBeenCalled();
    });
  });
});
