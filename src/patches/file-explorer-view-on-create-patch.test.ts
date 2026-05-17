import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';

import { TAbstractFile } from 'obsidian';
import { isFolder } from 'obsidian-dev-utils/obsidian/file-system';
import { registerPatch } from 'obsidian-dev-utils/obsidian/monkey-around';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { IgnorePatternsComponent } from '../ignore-patterns-component.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import { ExcludeMode } from '../plugin-settings.ts';
import { FileExplorerViewOnCreatePatch } from './file-explorer-view-on-create-patch.ts';

vi.mock('obsidian-dev-utils/obsidian/monkey-around', () => ({
  registerPatch: vi.fn()
}));

vi.mock('obsidian-dev-utils/object-utils', () => ({
  getPrototypeOf: vi.fn((obj: object) => Object.getPrototypeOf(obj))
}));

vi.mock('obsidian-dev-utils/obsidian/file-system', () => ({
  isFolder: vi.fn().mockReturnValue(false)
}));

const mockRegisterPatch = vi.mocked(registerPatch);
const mockIsFolder = vi.mocked(isFolder);

describe('FileExplorerViewOnCreatePatch', () => {
  let app: App;
  let ignorePatternsComponent: IgnorePatternsComponent;
  let pluginSettingsComponent: PluginSettingsComponent;
  let mockSettings: PluginSettings;
  let patch: FileExplorerViewOnCreatePatch;
  let mockIsIgnored: ReturnType<typeof vi.fn<(normalizedPath: string, isFolder: boolean) => boolean>>;

  beforeEach(() => {
    mockRegisterPatch.mockClear();
    app = App.createConfigured__();
    mockSettings = {
      excludeMode: ExcludeMode.Full,
      obsidianIgnoreContent: '',
      shouldIgnoreExcludedFiles: false,
      shouldIncludeGitIgnorePatterns: true
    };
    mockIsIgnored = vi.fn<(normalizedPath: string, isFolder: boolean) => boolean>().mockReturnValue(false);
    ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
      isIgnored: mockIsIgnored
    });
    pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
      settings: mockSettings
    });
    patch = new FileExplorerViewOnCreatePatch({
      app: app.asOriginalType__(),
      ignorePatternsComponent,
      pluginSettingsComponent
    });
  });

  describe('onLayoutReady', () => {
    it('should not register patch when no file explorer view exists', () => {
      patch.onLayoutReady();
      expect(mockRegisterPatch).not.toHaveBeenCalled();
    });

    it('should register patch when file explorer view exists', () => {
      const mockView = { onCreate: vi.fn() };
      const mockLeaf = { view: mockView };
      vi.spyOn(app.workspace, 'getLeavesOfType').mockReturnValue([mockLeaf as never]);

      patch.onLayoutReady();

      expect(mockRegisterPatch).toHaveBeenCalledWith(
        patch,
        expect.anything(),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() returns any by design
        expect.objectContaining({ onCreate: expect.any(Function) })
      );
    });
  });

  describe('patched onCreate', () => {
    let mockView: FileExplorerView;
    let mockFile: TAbstractFile;
    let onCreateNext: ReturnType<typeof vi.fn<(file: TAbstractFile) => void>>;

    beforeEach(() => {
      mockView = strictProxy<FileExplorerView>({});
      onCreateNext = vi.fn<(file: TAbstractFile) => void>();
      mockFile = strictProxy<TAbstractFile>({
        path: 'test.md'
      });

      const mockLeaf = { view: mockView };
      vi.spyOn(app.workspace, 'getLeavesOfType').mockReturnValue([mockLeaf as never]);

      patch.onLayoutReady();
    });

    function getPatchedOnCreate(): (file: TAbstractFile) => void {
      const patchDefs = mockRegisterPatch.mock.calls[0]?.[2] as Record<string, (next: (file: TAbstractFile) => void) => (file: TAbstractFile) => void>;
      const onCreateFactory = patchDefs['onCreate'];
      if (!onCreateFactory) {
        throw new Error('onCreate patch not found');
      }
      return onCreateFactory(onCreateNext);
    }

    it('should call next when excludeMode is not FilesPane', () => {
      mockSettings.excludeMode = ExcludeMode.Full;
      const patchedOnCreate = getPatchedOnCreate();

      patchedOnCreate.call(mockView, mockFile);

      expect(onCreateNext).toHaveBeenCalled();
    });

    it('should call next when excludeMode is FilesPane and file is not ignored', () => {
      mockSettings.excludeMode = ExcludeMode.FilesPane;
      mockIsIgnored.mockReturnValue(false);
      mockIsFolder.mockReturnValue(false);
      const patchedOnCreate = getPatchedOnCreate();

      patchedOnCreate.call(mockView, mockFile);

      expect(onCreateNext).toHaveBeenCalled();
    });

    it('should not call next when excludeMode is FilesPane and file is ignored', () => {
      mockSettings.excludeMode = ExcludeMode.FilesPane;
      mockIsIgnored.mockReturnValue(true);
      mockIsFolder.mockReturnValue(false);
      const patchedOnCreate = getPatchedOnCreate();

      patchedOnCreate.call(mockView, mockFile);

      expect(onCreateNext).not.toHaveBeenCalled();
    });

    it('should check isFolder for the file', () => {
      mockSettings.excludeMode = ExcludeMode.FilesPane;
      mockIsFolder.mockReturnValue(true);
      mockIsIgnored.mockReturnValue(false);
      const patchedOnCreate = getPatchedOnCreate();

      patchedOnCreate.call(mockView, mockFile);

      expect(mockIsFolder).toHaveBeenCalledWith(mockFile);
      expect(mockIsIgnored).toHaveBeenCalledWith('test.md', true);
    });
  });
});
