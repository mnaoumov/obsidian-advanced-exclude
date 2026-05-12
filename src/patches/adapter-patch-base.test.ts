import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
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
import type { PluginSettings } from '../plugin-settings.ts';
import type {
  DataAdapterReconcileDeletionFn,
  GenericReconcileFn
} from './adapter-patch-base.ts';

import { ExcludeMode } from '../plugin-settings.ts';
import { AdapterPatchBase } from './adapter-patch-base.ts';

class TestAdapterPatchBase extends AdapterPatchBase {
  public testGenerateReconcileWrapper(next: GenericReconcileFn, isFolder: boolean): GenericReconcileFn {
    return this.generateReconcileWrapper(next, isFolder);
  }

  public async testReconcileDeletion(
    next: DataAdapterReconcileDeletionFn,
    normalizedPath: string,
    normalizedNewPath: string,
    shouldSkipDeletionTimeout?: boolean
  ): Promise<void> {
    return this.reconcileDeletion(next, normalizedPath, normalizedNewPath, shouldSkipDeletionTimeout);
  }
}

describe('AdapterPatchBase', () => {
  let app: App;
  let ignorePatternsComponent: IgnorePatternsComponent;
  let pluginSettingsComponent: PluginSettingsComponent;
  let fileTreeComponent: FileTreeComponent;
  let patchBase: TestAdapterPatchBase;
  let mockSettings: PluginSettings;
  let mockIsIgnored: ReturnType<typeof vi.fn<(normalizedPath: string, isFolder: boolean) => boolean>>;
  let mockHandleDeletedOrDotFile: ReturnType<typeof vi.fn<(normalizedPath: string) => Promise<void>>>;
  let mockDeleteFromFilesPane: ReturnType<typeof vi.fn<(normalizedPath: string) => void>>;

  beforeEach(() => {
    app = App.createConfigured__();
    mockSettings = {
      excludeMode: ExcludeMode.Full,
      obsidianIgnoreContent: '',
      shouldIgnoreExcludedFiles: false,
      shouldIncludeGitIgnorePatterns: true
    };
    mockIsIgnored = vi.fn<(normalizedPath: string, isFolder: boolean) => boolean>().mockReturnValue(false);
    mockHandleDeletedOrDotFile = vi.fn<(normalizedPath: string) => Promise<void>>().mockResolvedValue(undefined);
    mockDeleteFromFilesPane = vi.fn<(normalizedPath: string) => void>();
    ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
      handleDeletedOrDotFile: mockHandleDeletedOrDotFile,
      isIgnored: mockIsIgnored
    });
    pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
      settings: mockSettings
    });
    fileTreeComponent = strictProxy<FileTreeComponent>({
      deleteFromFilesPane: mockDeleteFromFilesPane
    });
    patchBase = new TestAdapterPatchBase({
      app: app.asOriginalType__(),
      fileTreeComponent,
      ignorePatternsComponent,
      pluginSettingsComponent
    });
  });

  describe('generateReconcileWrapper', () => {
    it('should call next when path is not ignored', async () => {
      mockIsIgnored.mockReturnValue(false);
      const next = vi.fn<GenericReconcileFn>().mockResolvedValue(undefined);
      const wrapper = patchBase.testGenerateReconcileWrapper(next, false);

      await wrapper('test.md');

      expect(next).toHaveBeenCalledWith('test.md');
      expect(mockDeleteFromFilesPane).not.toHaveBeenCalled();
    });

    it('should return early when path is ignored and mode is Full', async () => {
      mockIsIgnored.mockReturnValue(true);
      mockSettings.excludeMode = ExcludeMode.Full;
      const next = vi.fn<GenericReconcileFn>().mockResolvedValue(undefined);
      const wrapper = patchBase.testGenerateReconcileWrapper(next, false);

      await wrapper('ignored.md');

      expect(next).not.toHaveBeenCalled();
      expect(mockDeleteFromFilesPane).not.toHaveBeenCalled();
    });

    it('should call next and remove from files pane when ignored and mode is FilesPane', async () => {
      mockIsIgnored.mockReturnValue(true);
      mockSettings.excludeMode = ExcludeMode.FilesPane;
      const next = vi.fn<GenericReconcileFn>().mockResolvedValue(undefined);
      const wrapper = patchBase.testGenerateReconcileWrapper(next, false);

      await wrapper('ignored.md');

      expect(next).toHaveBeenCalledWith('ignored.md');
      expect(mockDeleteFromFilesPane).toHaveBeenCalledWith('ignored.md');
    });

    it('should pass isFolder flag to isIgnored', async () => {
      mockIsIgnored.mockReturnValue(false);
      const next = vi.fn<GenericReconcileFn>().mockResolvedValue(undefined);
      const wrapper = patchBase.testGenerateReconcileWrapper(next, true);

      await wrapper('folder');

      expect(mockIsIgnored).toHaveBeenCalledWith('folder', true);
    });

    it('should forward additional arguments to next', async () => {
      mockIsIgnored.mockReturnValue(false);
      const next = vi.fn<GenericReconcileFn>().mockResolvedValue(undefined);
      const wrapper = patchBase.testGenerateReconcileWrapper(next, false);

      await wrapper('test.md', 'extra1', 'extra2');

      expect(next).toHaveBeenCalledWith('test.md', 'extra1', 'extra2');
    });
  });

  describe('reconcileDeletion', () => {
    it('should call next with correct arguments', async () => {
      const next = vi.fn<DataAdapterReconcileDeletionFn>().mockResolvedValue(undefined);
      app.workspace.layoutReady = false;

      await patchBase.testReconcileDeletion(next, 'path', 'newPath', true);

      expect(next).toHaveBeenCalled();
    });

    it('should not call handleDeletedOrDotFile when layout is not ready', async () => {
      const next = vi.fn<DataAdapterReconcileDeletionFn>().mockResolvedValue(undefined);
      app.workspace.layoutReady = false;

      await patchBase.testReconcileDeletion(next, 'path', 'newPath');

      expect(mockHandleDeletedOrDotFile).not.toHaveBeenCalled();
    });

    it('should call handleDeletedOrDotFile when layout is ready', async () => {
      const next = vi.fn<DataAdapterReconcileDeletionFn>().mockResolvedValue(undefined);
      app.workspace.layoutReady = true;

      await patchBase.testReconcileDeletion(next, 'path', 'newPath');

      expect(mockHandleDeletedOrDotFile).toHaveBeenCalledWith('path');
    });
  });
});
