import { registerPatch } from 'obsidian-dev-utils/obsidian/monkey-around';
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
import type { PluginSettings } from '../plugin-settings.ts';

import { ExcludeMode } from '../plugin-settings.ts';
import { FileSystemAdapterPatch } from './file-system-adapter-patch.ts';

vi.mock('obsidian-dev-utils/obsidian/monkey-around', () => ({
  registerPatch: vi.fn()
}));

const mockRegisterPatch = vi.mocked(registerPatch);

describe('FileSystemAdapterPatch', () => {
  let app: App;
  let adapter: FileSystemAdapter;
  let ignorePatternsComponent: IgnorePatternsComponent;
  let pluginSettingsComponent: PluginSettingsComponent;
  let fileTreeComponent: FileTreeComponent;
  let mockSettings: PluginSettings;
  let mockIsIgnored: ReturnType<typeof vi.fn<(normalizedPath: string, isFolder: boolean) => boolean>>;
  let mockHandleDeletedOrDotFile: ReturnType<typeof vi.fn<(normalizedPath: string) => Promise<void>>>;

  beforeEach(() => {
    mockRegisterPatch.mockClear();
    adapter = FileSystemAdapter.create__('/vault');
    app = App.createConfigured__({ adapter: adapter.asOriginalType__() });
    mockSettings = {
      excludeMode: ExcludeMode.Full,
      obsidianIgnoreContent: '',
      shouldIgnoreExcludedFiles: false,
      shouldIncludeGitIgnorePatterns: true
    };
    mockIsIgnored = vi.fn<(normalizedPath: string, isFolder: boolean) => boolean>().mockReturnValue(false);
    mockHandleDeletedOrDotFile = vi.fn<(normalizedPath: string) => Promise<void>>().mockResolvedValue(undefined);
    ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
      handleDeletedOrDotFile: mockHandleDeletedOrDotFile,
      isIgnored: mockIsIgnored
    });
    pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
      settings: mockSettings
    });
    fileTreeComponent = strictProxy<FileTreeComponent>({
      deleteFromFilesPane: vi.fn()
    });
  });

  it('should register patches on onload', () => {
    const patch = new FileSystemAdapterPatch({
      adapter: adapter.asOriginalType__(),
      app: app.asOriginalType__(),
      fileTreeComponent,
      ignorePatternsComponent,
      pluginSettingsComponent
    });

    patch.onload();

    expect(mockRegisterPatch).toHaveBeenCalledWith(
      patch,
      adapter,
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() returns any by design
        reconcileDeletion: expect.any(Function),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() returns any by design
        reconcileFileCreation: expect.any(Function),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() returns any by design
        reconcileFolderCreation: expect.any(Function)
      })
    );
  });

  describe('patched reconcileFileCreation', () => {
    it('should call next when file is not ignored', async () => {
      mockIsIgnored.mockReturnValue(false);
      const patch = new FileSystemAdapterPatch({
        adapter: adapter.asOriginalType__(),
        app: app.asOriginalType__(),
        fileTreeComponent,
        ignorePatternsComponent,
        pluginSettingsComponent
      });
      patch.onload();

      const patchDefs = mockRegisterPatch.mock.calls[0]?.[2] as Record<
        string,
        (next: (...args: unknown[]) => Promise<void>) => (...args: unknown[]) => Promise<void>
      >;
      const reconcileFileCreation = patchDefs['reconcileFileCreation'];
      if (!reconcileFileCreation) {
        throw new Error('reconcileFileCreation patch not found');
      }
      const next = vi.fn().mockResolvedValue(undefined);
      const patchedFn = reconcileFileCreation(next);

      await patchedFn('test.md');

      expect(next).toHaveBeenCalled();
      expect(mockIsIgnored).toHaveBeenCalledWith('test.md', false);
    });
  });

  describe('patched reconcileFolderCreation', () => {
    it('should call next when folder is not ignored', async () => {
      mockIsIgnored.mockReturnValue(false);
      const patch = new FileSystemAdapterPatch({
        adapter: adapter.asOriginalType__(),
        app: app.asOriginalType__(),
        fileTreeComponent,
        ignorePatternsComponent,
        pluginSettingsComponent
      });
      patch.onload();

      const patchDefs = mockRegisterPatch.mock.calls[0]?.[2] as Record<
        string,
        (next: (...args: unknown[]) => Promise<void>) => (...args: unknown[]) => Promise<void>
      >;
      const reconcileFolderCreation = patchDefs['reconcileFolderCreation'];
      if (!reconcileFolderCreation) {
        throw new Error('reconcileFolderCreation patch not found');
      }
      const next = vi.fn().mockResolvedValue(undefined);
      const patchedFn = reconcileFolderCreation(next);

      await patchedFn('folder');

      expect(next).toHaveBeenCalled();
      expect(mockIsIgnored).toHaveBeenCalledWith('folder', true);
    });
  });

  describe('patched reconcileDeletion', () => {
    it('should call next and handle deletion', async () => {
      const patch = new FileSystemAdapterPatch({
        adapter: adapter.asOriginalType__(),
        app: app.asOriginalType__(),
        fileTreeComponent,
        ignorePatternsComponent,
        pluginSettingsComponent
      });
      patch.onload();

      const patchDefs = mockRegisterPatch.mock.calls[0]?.[2] as Record<
        string,
        (next: (...args: unknown[]) => Promise<void>) => (...args: unknown[]) => Promise<void>
      >;
      const reconcileDeletion = patchDefs['reconcileDeletion'];
      if (!reconcileDeletion) {
        throw new Error('reconcileDeletion patch not found');
      }
      const next = vi.fn().mockResolvedValue(undefined);
      const patchedFn = reconcileDeletion(next);
      app.workspace.layoutReady = true;

      await patchedFn('path', 'newPath', false);

      expect(next).toHaveBeenCalled();
      expect(mockHandleDeletedOrDotFile).toHaveBeenCalledWith('path');
    });
  });
});
