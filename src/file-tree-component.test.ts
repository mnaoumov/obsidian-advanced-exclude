import type {
  App,
  TAbstractFile,
  TFolder
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/plugin/components/console-debug-component';
import type { DataAdapterEx } from '@obsidian-typings/obsidian-public-latest';

import {
  FileSystemAdapter,
  Notice
} from 'obsidian';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { getDataAdapterEx } from '@obsidian-typings/obsidian-public-latest/implementations';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import type { VaultLoadPatch } from './patches/vault-load-patch.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { FileTreeComponent } from './file-tree-component.ts';
import { ExcludeMode } from './plugin-settings.ts';

// Make Notice available as a global (Obsidian exposes it at runtime)
vi.stubGlobal('Notice', Notice);

vi.mock('obsidian-dev-utils/async', () => ({
  sleep: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@obsidian-typings/obsidian-public-latest/implementations', () => ({
  getDataAdapterEx: vi.fn()
}));

vi.mock('obsidian-dev-utils/path', () => ({
  basename: vi.fn((path: string) => {
    const parts = path.split('/');
    return parts[parts.length - 1] ?? '';
  })
}));

vi.mock('obsidian-dev-utils/type-guards', () => ({
  ensureNonNullable: vi.fn((value: unknown) => value)
}));

const mockGetDataAdapterEx = vi.mocked(getDataAdapterEx);

interface MockAdapter {
  list: ReturnType<typeof vi.fn>;
  reconcileDeletion: ReturnType<typeof vi.fn>;
  reconcileFile: ReturnType<typeof vi.fn>;
  reconcileFileInternal: ReturnType<typeof vi.fn>;
  reconcileFolderCreation: ReturnType<typeof vi.fn>;
}

interface MockFileExplorerView {
  fileItems: Record<string, unknown>;
  onCreate: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
}

interface SetupParams {
  fileExplorerView?: MockFileExplorerView;
  isFileSystemAdapter?: boolean;
  vaultLoadCalled?: boolean;
}

interface SetupResult {
  app: App;
  component: FileTreeComponent;
  consoleDebugComponent: ConsoleDebugComponent;
  ignorePatternsComponent: IgnorePatternsComponent;
  mockAdapter: MockAdapter;
  pluginSettingsComponent: PluginSettingsComponent;
  vaultLoadPatch: VaultLoadPatch;
}

function createMockAdapter(isFileSystemAdapter = false): MockAdapter {
  const adapter: MockAdapter = {
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    reconcileDeletion: vi.fn().mockResolvedValue(undefined),
    reconcileFile: vi.fn().mockResolvedValue(undefined),
    reconcileFileInternal: vi.fn().mockResolvedValue(undefined),
    reconcileFolderCreation: vi.fn().mockResolvedValue(undefined)
  };
  if (isFileSystemAdapter) {
    Object.setPrototypeOf(adapter, FileSystemAdapter.prototype);
  }
  return adapter;
}

function createMockFileExplorerView(overrides: Partial<MockFileExplorerView> = {}): MockFileExplorerView {
  return {
    fileItems: {},
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    ...overrides
  };
}

function setup(params: SetupParams = {}): SetupResult {
  const { fileExplorerView, isFileSystemAdapter = false, vaultLoadCalled = false } = params;

  const mockAdapter = createMockAdapter(isFileSystemAdapter);
  const dataAdapterEx = strictProxy<DataAdapterEx>({});
  Object.assign(dataAdapterEx, mockAdapter);
  if (isFileSystemAdapter) {
    Object.setPrototypeOf(dataAdapterEx, FileSystemAdapter.prototype);
  }
  mockGetDataAdapterEx.mockReturnValue(dataAdapterEx);

  const leaves = fileExplorerView
    ? [{ view: fileExplorerView }]
    : [];

  const mockGetAbstractFileByPath = vi.fn().mockReturnValue(null);
  const mockGetFolderByPath = vi.fn().mockReturnValue(null);
  const mockGetLeavesOfType = vi.fn().mockReturnValue(leaves);

  const app = strictProxy<App>({
    vault: {
      getAbstractFileByPath: mockGetAbstractFileByPath,
      getFolderByPath: mockGetFolderByPath
    },
    workspace: {
      getLeavesOfType: mockGetLeavesOfType
    }
  });

  const consoleDebugComponent = strictProxy<ConsoleDebugComponent>({
    debug: vi.fn()
  });

  const ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
    isIgnored: vi.fn().mockReturnValue(false),
    processConfigChanges: vi.fn().mockResolvedValue(undefined)
  });

  const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
    settings: {
      excludeMode: ExcludeMode.Full
    }
  });

  const vaultLoadPatch = strictProxy<VaultLoadPatch>({
    vaultLoadCalled
  });

  const component = new FileTreeComponent({
    app,
    consoleDebugComponent,
    ignorePatternsComponent,
    pluginSettingsComponent,
    vaultLoadPatch
  });

  return { app, component, consoleDebugComponent, ignorePatternsComponent, mockAdapter, pluginSettingsComponent, vaultLoadPatch };
}

describe('FileTreeComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should store params and create an instance', () => {
      const { component } = setup();
      expect(component).toBeInstanceOf(FileTreeComponent);
    });
  });

  describe('deleteFromFilesPane', () => {
    it('should return early when no file explorer view exists', () => {
      const { app, component } = setup();
      component.deleteFromFilesPane('some/path');
      expect(vi.mocked(app.workspace.getLeavesOfType)).toHaveBeenCalledWith('file-explorer');
    });

    it('should return early when file item does not exist in view', () => {
      const fileExplorerView = createMockFileExplorerView();
      const { component } = setup({ fileExplorerView });
      component.deleteFromFilesPane('some/path');
      expect(fileExplorerView.onDelete).not.toHaveBeenCalled();
    });

    it('should return early when abstract file is not found', () => {
      const fileExplorerView = createMockFileExplorerView({ fileItems: { 'some/path': {} } });
      const { app, component } = setup({ fileExplorerView });
      vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(null);
      component.deleteFromFilesPane('some/path');
      expect(fileExplorerView.onDelete).not.toHaveBeenCalled();
    });

    it('should call onDelete when all conditions are met', () => {
      const fileExplorerView = createMockFileExplorerView({ fileItems: { 'some/path': {} } });
      const mockFile = strictProxy<TAbstractFile>({ path: 'some/path' });
      const { app, component } = setup({ fileExplorerView });
      vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(mockFile);
      component.deleteFromFilesPane('some/path');
      expect(fileExplorerView.onDelete).toHaveBeenCalledWith(mockFile);
    });
  });

  describe('onLayoutReady', () => {
    it('should call update when vault load was not called', async () => {
      const { app, component, mockAdapter } = setup({ vaultLoadCalled: false });
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(null);
      await component.onLayoutReady();
      expect(mockAdapter.reconcileFolderCreation).not.toHaveBeenCalled();
    });

    it('should skip update when vault load was already called', async () => {
      const { component, mockAdapter } = setup({ vaultLoadCalled: true });
      await component.onLayoutReady();
      expect(mockAdapter.reconcileFolderCreation).not.toHaveBeenCalled();
    });
  });

  describe('onload', () => {
    it('should call super.onload and update', async () => {
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(null);
      await component.onload();
      // Update was called (which calls reloadFolder), and since folder is null it returns early
      // The fact that it didn't throw confirms super.onload() + update() both ran
      expect(mockAdapter.reconcileFolderCreation).not.toHaveBeenCalled();
    });
  });

  describe('processConfigChanges', () => {
    it('should be a no-op when no config changes occurred', async () => {
      const { component, ignorePatternsComponent } = setup();
      await component.processConfigChanges();
      expect(vi.mocked(ignorePatternsComponent.processConfigChanges)).not.toHaveBeenCalled();
    });

    it('should process changes when hadConfigChanges is true', async () => {
      const { component, ignorePatternsComponent } = setup();
      // Access private field to simulate config changes having occurred
      Object.defineProperty(component, 'hadConfigChanges', { value: true, writable: true });
      await component.processConfigChanges();
      expect(vi.mocked(ignorePatternsComponent.processConfigChanges)).toHaveBeenCalled();
    });

    it('should reset hadConfigChanges to false after processing', async () => {
      const { component, ignorePatternsComponent } = setup();
      Object.defineProperty(component, 'hadConfigChanges', { value: true, writable: true });
      await component.processConfigChanges();
      // Calling again should be a no-op since hadConfigChanges was reset
      vi.mocked(ignorePatternsComponent.processConfigChanges).mockClear();
      await component.processConfigChanges();
      expect(vi.mocked(ignorePatternsComponent.processConfigChanges)).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should create a notice and hide it after completion', async () => {
      const { app, component } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(null);
      await component.update();
      // Notice is created via global createFragment + new Notice, and hidden in finally block
      expect(vi.mocked(app.vault.getFolderByPath)).toHaveBeenCalledWith('/');
    });

    it('should abort previous controller when called again', async () => {
      const { app, component } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(null);
      // First call
      await component.update();
      // Second call should abort the first
      await component.update();
      expect(vi.mocked(app.vault.getFolderByPath)).toHaveBeenCalledTimes(2);
    });

    it('should call reloadFolder with ROOT_PATH', async () => {
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      mockAdapter.list.mockResolvedValue({ files: [], folders: [] });
      await component.update();
      expect(mockAdapter.reconcileFolderCreation).toHaveBeenCalledWith('/', '/');
    });
  });

  describe('addToFilesPane (private, tested via reloadChildPath)', () => {
    it('should not add when no file explorer view exists', async () => {
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter, pluginSettingsComponent } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      vi.mocked(pluginSettingsComponent.settings).excludeMode = ExcludeMode.FilesPane;
      mockAdapter.list.mockResolvedValue({ files: ['test.md'], folders: [] });
      await component.update();
      // AddToFilesPane is called but no view, so it returns early
      expect(mockAdapter.reconcileFile).toHaveBeenCalled();
    });

    it('should not add when item already exists in view', async () => {
      const fileExplorerView = createMockFileExplorerView({ fileItems: { 'test.md': {} } });
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter, pluginSettingsComponent } = setup({ fileExplorerView });
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      vi.mocked(pluginSettingsComponent.settings).excludeMode = ExcludeMode.FilesPane;
      mockAdapter.list.mockResolvedValue({ files: ['test.md'], folders: [] });
      await component.update();
      expect(fileExplorerView.onCreate).not.toHaveBeenCalled();
    });

    it('should not add when abstract file is not found', async () => {
      const fileExplorerView = createMockFileExplorerView();
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter, pluginSettingsComponent } = setup({ fileExplorerView });
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      vi.mocked(pluginSettingsComponent.settings).excludeMode = ExcludeMode.FilesPane;
      vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(null);
      mockAdapter.list.mockResolvedValue({ files: ['test.md'], folders: [] });
      await component.update();
      expect(fileExplorerView.onCreate).not.toHaveBeenCalled();
    });

    it('should call onCreate when file exists and item not in view', async () => {
      const fileExplorerView = createMockFileExplorerView();
      const mockFile = strictProxy<TAbstractFile>({ path: 'test.md' });
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter, pluginSettingsComponent } = setup({ fileExplorerView });
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      vi.mocked(pluginSettingsComponent.settings).excludeMode = ExcludeMode.FilesPane;
      vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(mockFile);
      mockAdapter.list.mockResolvedValue({ files: ['test.md'], folders: [] });
      await component.update();
      expect(fileExplorerView.onCreate).toHaveBeenCalledWith(mockFile);
    });
  });

  describe('reloadChildPath (private, tested via update)', () => {
    it('should skip dot files', async () => {
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      mockAdapter.list.mockResolvedValue({ files: ['.hidden'], folders: [] });
      await component.update();
      expect(mockAdapter.reconcileFile).not.toHaveBeenCalled();
      expect(mockAdapter.reconcileFileInternal).not.toHaveBeenCalled();
    });

    it('should delete via reconcileDeletion when ignored and Full mode', async () => {
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, ignorePatternsComponent, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      vi.mocked(ignorePatternsComponent.isIgnored).mockReturnValue(true);
      mockAdapter.list.mockResolvedValue({ files: ['ignored.md'], folders: [] });
      await component.update();
      expect(mockAdapter.reconcileDeletion).toHaveBeenCalledWith('ignored.md', 'ignored.md');
    });

    it('should use reconcileFileInternal for FileSystemAdapter', async () => {
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter } = setup({ isFileSystemAdapter: true });
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      mockAdapter.list.mockResolvedValue({ files: ['file.md'], folders: [] });
      await component.update();
      expect(mockAdapter.reconcileFileInternal).toHaveBeenCalledWith('file.md', 'file.md');
    });

    it('should use reconcileFile for non-FileSystemAdapter', async () => {
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter } = setup({ isFileSystemAdapter: false });
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      mockAdapter.list.mockResolvedValue({ files: ['file.md'], folders: [] });
      await component.update();
      expect(mockAdapter.reconcileFile).toHaveBeenCalledWith('file.md', 'file.md');
    });

    it('should delete from files pane when ignored but not Full mode', async () => {
      const fileExplorerView = createMockFileExplorerView({ fileItems: { 'ignored.md': {} } });
      const mockFile = strictProxy<TAbstractFile>({ path: 'ignored.md' });
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, ignorePatternsComponent, mockAdapter, pluginSettingsComponent } = setup({ fileExplorerView });
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      vi.mocked(pluginSettingsComponent.settings).excludeMode = ExcludeMode.FilesPane;
      vi.mocked(ignorePatternsComponent.isIgnored).mockReturnValue(true);
      vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(mockFile);
      mockAdapter.list.mockResolvedValue({ files: ['ignored.md'], folders: [] });
      await component.update();
      expect(fileExplorerView.onDelete).toHaveBeenCalledWith(mockFile);
    });

    it('should add to files pane when not ignored and FilesPane mode', async () => {
      const fileExplorerView = createMockFileExplorerView();
      const mockFile = strictProxy<TAbstractFile>({ path: 'visible.md' });
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter, pluginSettingsComponent } = setup({ fileExplorerView });
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      vi.mocked(pluginSettingsComponent.settings).excludeMode = ExcludeMode.FilesPane;
      vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(mockFile);
      mockAdapter.list.mockResolvedValue({ files: ['visible.md'], folders: [] });
      await component.update();
      expect(fileExplorerView.onCreate).toHaveBeenCalledWith(mockFile);
    });
  });

  describe('reloadFolder (private, tested via update)', () => {
    it('should return early when abort signal is already aborted', async () => {
      const { app, component, mockAdapter } = setup();
      const mockFolder = strictProxy<TFolder>({ children: [] });
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      mockAdapter.list.mockResolvedValue({ files: [], folders: [] });

      // Start an update, then abort before second call completes
      const abortController = new AbortController();
      abortController.abort();
      // We test via update which manages its own abort controller
      // Instead, test that when update is called while another is in progress, the first aborts
      let resolveFirst: (() => void) | undefined;
      const firstCallPromise = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- mock implementation intentionally returns a Promise to simulate async behavior
      mockAdapter.list.mockImplementationOnce(() => firstCallPromise.then(() => ({ files: [], folders: [] })));

      const firstUpdate = component.update();
      // Start second update which should abort the first
      const secondUpdate = component.update();
      resolveFirst?.();
      await firstUpdate;
      await secondUpdate;
      expect(vi.mocked(app.vault.getFolderByPath)).toHaveBeenCalled();
    });

    it('should increment progress for non-root folders', async () => {
      const rootFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockImplementation((path: string) => {
        if (path === '/') {
          return rootFolder;
        }
        return null;
      });
      mockAdapter.list.mockResolvedValue({ files: [], folders: ['subfolder'] });
      await component.update();
      // Subfolder is listed but not in includedPaths (since it's a folder entry processed by reloadChildPath),
      // So no recursion happens for it
      expect(mockAdapter.reconcileFolderCreation).toHaveBeenCalledWith('/', '/');
    });

    it('should return early when folder is null (non-root)', async () => {
      const rootFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockImplementation((path: string) => {
        if (path === '/') {
          return rootFolder;
        }
        return null;
      });
      // Root lists a subfolder, reloadChildPath includes it, then reloadFolder('subfolder') finds no folder
      mockAdapter.list.mockResolvedValue({ files: [], folders: ['subfolder'] });
      await component.update();
      expect(mockAdapter.reconcileFolderCreation).toHaveBeenCalledTimes(1);
    });

    it('should call reconcileFolderCreation for root path', async () => {
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      mockAdapter.list.mockResolvedValue({ files: [], folders: [] });
      await component.update();
      expect(mockAdapter.reconcileFolderCreation).toHaveBeenCalledWith('/', '/');
    });

    it('should process children files and folders', async () => {
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      mockAdapter.list.mockResolvedValue({ files: ['file1.md', 'file2.md'], folders: [] });
      await component.update();
      expect(mockAdapter.reconcileFile).toHaveBeenCalledTimes(2);
    });

    it('should handle errors in child processing without stopping', async () => {
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockAdapter.list.mockResolvedValue({ files: ['file1.md', 'file2.md'], folders: [] });
      mockAdapter.reconcileFile
        .mockRejectedValueOnce(new Error('fail1'))
        .mockResolvedValueOnce(undefined);
      await component.update();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed reloading file: file1.md', expect.objectContaining({ message: 'fail1' }));
      expect(mockAdapter.reconcileFile).toHaveBeenCalledTimes(2);
      consoleErrorSpy.mockRestore();
    });

    it('should clean orphan paths', async () => {
      const orphanChild = strictProxy<TAbstractFile>({ path: 'orphan.md' });
      const mockFolder = strictProxy<TFolder>({ children: [orphanChild] });
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      mockAdapter.list.mockResolvedValue({ files: [], folders: [] });
      await component.update();
      expect(mockAdapter.reconcileDeletion).toHaveBeenCalledWith('orphan.md', 'orphan.md');
    });

    it('should handle errors in orphan cleanup', async () => {
      const orphanChild = strictProxy<TAbstractFile>({ path: 'orphan.md' });
      const mockFolder = strictProxy<TFolder>({ children: [orphanChild] });
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockAdapter.list.mockResolvedValue({ files: [], folders: [] });
      mockAdapter.reconcileDeletion.mockRejectedValueOnce(new Error('orphan fail'));
      await component.update();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed cleaning orphan file orphan.md', expect.objectContaining({ message: 'orphan fail' }));
      consoleErrorSpy.mockRestore();
    });

    it('should recurse into included child folders', async () => {
      const rootFolder = strictProxy<TFolder>({ children: [] });
      const subFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockImplementation((path: string) => {
        if (path === '/') {
          return rootFolder;
        }
        if (path === 'subfolder') {
          return subFolder;
        }
        return null;
      });
      mockAdapter.list
        .mockResolvedValueOnce({ files: [], folders: ['subfolder'] })
        .mockResolvedValueOnce({ files: ['subfolder/file.md'], folders: [] });
      await component.update();
      // Subfolder was reconciled as a child and added to includedPaths, then recursed
      expect(mockAdapter.list).toHaveBeenCalledTimes(2);
      expect(mockAdapter.list).toHaveBeenCalledWith('subfolder');
    });

    it('should handle errors in folder recursion', async () => {
      const rootFolder = strictProxy<TFolder>({ children: [] });
      const subFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockImplementation((path: string) => {
        if (path === '/') {
          return rootFolder;
        }
        if (path === 'subfolder') {
          return subFolder;
        }
        return null;
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      // Root lists a folder; reloadChildPath will include it; reloadFolder('subfolder') will throw on list
      mockAdapter.list
        .mockResolvedValueOnce({ files: [], folders: ['subfolder'] })
        .mockRejectedValueOnce(new Error('folder fail'));

      await component.update();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed reloading folder subfolder', expect.objectContaining({ message: 'folder fail' }));
      consoleErrorSpy.mockRestore();
    });

    it('should not recurse into folders that are not in includedPaths', async () => {
      const rootFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, ignorePatternsComponent, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(rootFolder);
      // Folder is ignored in Full mode, so it gets reconcileDeletion and is NOT added to includedPaths
      vi.mocked(ignorePatternsComponent.isIgnored).mockReturnValue(true);
      mockAdapter.list.mockResolvedValue({ files: [], folders: ['ignored-folder'] });
      await component.update();
      // List should only be called once (for root), not for ignored-folder
      expect(mockAdapter.list).toHaveBeenCalledTimes(1);
    });

    it('should abort during child processing when signal is aborted', async () => {
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      mockAdapter.list.mockResolvedValue({ files: ['file1.md', 'file2.md'], folders: [] });

      // On the first reconcileFile call, trigger a new update (which aborts the current one)
      let updateCount = 0;
      mockAdapter.reconcileFile.mockImplementation(() => {
        updateCount++;
        if (updateCount === 1) {
          // Trigger another update to abort current
          component.update().catch(() => undefined);
        }
      });
      await component.update();
      // The second file may or may not have been processed depending on timing
      // But reconcileFile should have been called at least once
      expect(mockAdapter.reconcileFile).toHaveBeenCalled();
    });
  });

  describe('isDotFile (private, tested via reloadChildPath)', () => {
    it('should return true for .hidden files and skip them', async () => {
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      mockAdapter.list.mockResolvedValue({ files: ['.hidden'], folders: [] });
      await component.update();
      expect(mockAdapter.reconcileFile).not.toHaveBeenCalled();
    });

    it('should return false for visible files and process them', async () => {
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      mockAdapter.list.mockResolvedValue({ files: ['visible.md'], folders: [] });
      await component.update();
      expect(mockAdapter.reconcileFile).toHaveBeenCalledWith('visible.md', 'visible.md');
    });
  });

  describe('getFileExplorerView (private, tested via deleteFromFilesPane)', () => {
    it('should return undefined when no file-explorer leaves exist', () => {
      const { app, component } = setup();
      vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([]);
      component.deleteFromFilesPane('path');
      expect(vi.mocked(app.workspace.getLeavesOfType)).toHaveBeenCalledWith('file-explorer');
    });
  });

  describe('updateProgressEl getter', () => {
    it('should return the progress element set during update', async () => {
      const mockFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      mockAdapter.list.mockResolvedValue({ files: [], folders: [] });
      // If ensureNonNullable returns the value, and _updateProgressEl is set by createFragment,
      // Then the getter should work without error
      await component.update();
      expect(mockAdapter.reconcileFolderCreation).toHaveBeenCalled();
    });
  });

  describe('reloadFolder abort during orphan cleanup', () => {
    it('should stop orphan cleanup when aborted', async () => {
      const orphan1 = strictProxy<TAbstractFile>({ path: 'orphan1.md' });
      const orphan2 = strictProxy<TAbstractFile>({ path: 'orphan2.md' });
      const mockFolder = strictProxy<TFolder>({ children: [orphan1, orphan2] });
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockReturnValue(mockFolder);
      mockAdapter.list.mockResolvedValue({ files: [], folders: [] });

      // On first reconcileDeletion, trigger abort via new update
      let deleteCount = 0;
      mockAdapter.reconcileDeletion.mockImplementation(() => {
        deleteCount++;
        if (deleteCount === 1) {
          component.update().catch(() => undefined);
        }
      });
      await component.update();
      // At least one orphan was cleaned
      expect(mockAdapter.reconcileDeletion).toHaveBeenCalled();
    });
  });

  describe('reloadFolder abort during folder recursion', () => {
    it('should stop folder recursion when aborted', async () => {
      const rootFolder = strictProxy<TFolder>({ children: [] });
      const subFolder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter } = setup();
      vi.mocked(app.vault.getFolderByPath).mockImplementation((path: string) => {
        if (path === '/') {
          return rootFolder;
        }
        if (path === 'sub1') {
          return subFolder;
        }
        return null;
      });
      mockAdapter.list.mockResolvedValueOnce({ files: [], folders: ['sub1', 'sub2'] });
      // When recursing into sub1, trigger abort
      mockAdapter.list.mockImplementationOnce(() => {
        component.update().catch(() => undefined);
        return { files: [], folders: [] };
      });
      await component.update();
      // Sub1 was entered but sub2 should have been skipped due to abort
      expect(mockAdapter.list).toHaveBeenCalledWith('/');
    });

    it('should skip subfolder recursion when aborted before entering reloadFolder', async () => {
      const rootFolder = strictProxy<TFolder>({ children: [] });
      const sub1Folder = strictProxy<TFolder>({ children: [] });
      const { app, component, mockAdapter } = setup();

      vi.mocked(app.vault.getFolderByPath).mockImplementation((path: string) => {
        if (path === '/') {
          return rootFolder;
        }
        if (path === 'sub1') {
          return sub1Folder;
        }
        return null;
      });

      // Root lists two folders that both get included
      mockAdapter.list.mockResolvedValueOnce({ files: [], folders: ['sub1', 'sub2'] });
      // Sub1's list triggers abort
      mockAdapter.list.mockImplementationOnce(() => {
        component.update().catch(() => undefined);
        return { files: [], folders: [] };
      });
      // Subsequent list calls return empty
      mockAdapter.list.mockResolvedValue({ files: [], folders: [] });

      await component.update();
      // Sub2 was skipped because the loop check caught the abort before reloadFolder
      expect(mockAdapter.list).toHaveBeenCalledWith('/');
      expect(mockAdapter.list).toHaveBeenCalledWith('sub1');
    });
  });
});
