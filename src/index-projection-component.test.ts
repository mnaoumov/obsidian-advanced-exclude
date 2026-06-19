import type { DataAdapterEx } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  TAbstractFile
} from 'obsidian';

import { getDataAdapterEx } from '@obsidian-typings/obsidian-public-latest/implementations';
import { isFolder } from 'obsidian-dev-utils/obsidian/file-system';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import type { VaultLoadPatchComponent } from './patches/vault-load-patch-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { IndexProjectionComponent } from './index-projection-component.ts';
import { ExcludeMode } from './plugin-settings.ts';

vi.mock('@obsidian-typings/obsidian-public-latest/implementations', () => ({
  getDataAdapterEx: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/file-system', () => ({
  isFolder: vi.fn()
}));

const mockGetDataAdapterEx = vi.mocked(getDataAdapterEx);
const mockIsFolder = vi.mocked(isFolder);

interface MockAdapter {
  reconcileDeletion: ReturnType<typeof vi.fn>;
  reconcileFile: ReturnType<typeof vi.fn>;
}

interface MockEntry {
  isFolderFlag: boolean;
  path: string;
}

interface SetupParams {
  readonly entries: readonly MockEntry[];
  readonly excludeMode?: ExcludeMode;
  isIgnored(normalizedPath: string): boolean;
  readonly vaultLoadCalled?: boolean;
}

interface SetupResult {
  readonly addToFilesPane: ReturnType<typeof vi.fn>;
  readonly component: IndexProjectionComponent;
  readonly deleteFromFilesPane: ReturnType<typeof vi.fn>;
  readonly mockAdapter: MockAdapter;
}

function setup(params: SetupParams): SetupResult {
  const { entries, excludeMode = ExcludeMode.Full, isIgnored, vaultLoadCalled = false } = params;

  const mockAdapter: MockAdapter = {
    reconcileDeletion: vi.fn().mockResolvedValue(undefined),
    reconcileFile: vi.fn().mockResolvedValue(undefined)
  };
  const dataAdapterEx = strictProxy<DataAdapterEx>({});
  Object.assign(dataAdapterEx, mockAdapter);
  mockGetDataAdapterEx.mockReturnValue(dataAdapterEx);

  const loadedFiles = entries.map((entry) => strictProxy<TAbstractFile>({ path: entry.path }));
  const flagByPath = new Map(entries.map((entry) => [entry.path, entry.isFolderFlag]));
  mockIsFolder.mockImplementation((file) => flagByPath.get((file as TAbstractFile).path) ?? false);

  const app = strictProxy<App>({
    vault: {
      getAllLoadedFiles: vi.fn().mockReturnValue(loadedFiles)
    },
    workspace: {
      onLayoutReady: vi.fn()
    }
  });

  const ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
    isIgnored: vi.fn((normalizedPath: string) => isIgnored(normalizedPath))
  });

  const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
    settings: { excludeMode }
  });

  const vaultLoadPatch = strictProxy<VaultLoadPatchComponent>({ vaultLoadCalled });

  const addToFilesPane = vi.fn();
  const deleteFromFilesPane = vi.fn();

  const component = new IndexProjectionComponent({
    addToFilesPane,
    app,
    deleteFromFilesPane,
    ignorePatternsComponent,
    pluginSettingsComponent,
    vaultLoadPatch
  });

  return { addToFilesPane, component, deleteFromFilesPane, mockAdapter };
}

describe('IndexProjectionComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('applyFull (Full mode)', () => {
    it('removes only the topmost hidden node of a fully-ignored subtree', async () => {
      const { component, mockAdapter } = setup({
        entries: [
          { isFolderFlag: true, path: '/' },
          { isFolderFlag: true, path: 'a' },
          { isFolderFlag: false, path: 'a/x.md' },
          { isFolderFlag: false, path: 'a/y.md' },
          { isFolderFlag: false, path: 'b.md' }
        ],
        isIgnored: (path) => path === 'a' || path.startsWith('a/')
      });

      await component.applyFull();

      expect(mockAdapter.reconcileDeletion).toHaveBeenCalledExactlyOnceWith('a', 'a');
      expect(component.model.isKnown('a/x.md')).toBe(true);
    });

    it('removes an individually-ignored file from a visible folder', async () => {
      const { component, mockAdapter } = setup({
        entries: [
          { isFolderFlag: true, path: 'a' },
          { isFolderFlag: false, path: 'a/keep.md' },
          { isFolderFlag: false, path: 'a/drop.md' }
        ],
        isIgnored: (path) => path === 'a/drop.md'
      });

      await component.applyFull();

      expect(mockAdapter.reconcileDeletion).toHaveBeenCalledExactlyOnceWith('a/drop.md', 'a/drop.md');
    });

    it('removes nothing when nothing is ignored', async () => {
      const { component, deleteFromFilesPane, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'a.md' }],
        isIgnored: () => false
      });

      await component.applyFull();

      expect(mockAdapter.reconcileDeletion).not.toHaveBeenCalled();
      expect(deleteFromFilesPane).not.toHaveBeenCalled();
    });
  });

  describe('applyFull (FilesPane mode)', () => {
    it('removes every hidden node from the files pane and touches no adapter', async () => {
      const { component, deleteFromFilesPane, mockAdapter } = setup({
        entries: [
          { isFolderFlag: true, path: 'a' },
          { isFolderFlag: false, path: 'a/keep.md' },
          { isFolderFlag: false, path: 'a/drop.md' }
        ],
        excludeMode: ExcludeMode.FilesPane,
        isIgnored: (path) => path === 'a/drop.md'
      });

      await component.applyFull();

      expect(deleteFromFilesPane).toHaveBeenCalledExactlyOnceWith('a/drop.md');
      expect(mockAdapter.reconcileDeletion).not.toHaveBeenCalled();
    });
  });

  describe('restoreAll', () => {
    it('re-adds the hidden roots via reconcileFile in Full mode', async () => {
      const { component, mockAdapter } = setup({
        entries: [
          { isFolderFlag: true, path: 'a' },
          { isFolderFlag: false, path: 'a/x.md' }
        ],
        isIgnored: (path) => path === 'a' || path.startsWith('a/')
      });

      await component.applyFull();
      await component.restoreAll();

      expect(mockAdapter.reconcileFile).toHaveBeenCalledExactlyOnceWith('a', 'a');
    });

    it('re-adds hidden nodes to the files pane in FilesPane mode', async () => {
      const { addToFilesPane, component } = setup({
        entries: [
          { isFolderFlag: true, path: 'a' },
          { isFolderFlag: false, path: 'a/drop.md' }
        ],
        excludeMode: ExcludeMode.FilesPane,
        isIgnored: (path) => path === 'a/drop.md'
      });

      await component.applyFull();
      await component.restoreAll();

      expect(addToFilesPane).toHaveBeenCalledExactlyOnceWith('a/drop.md');
    });
  });

  describe('applyDelta', () => {
    it('hides nodes that flipped hidden and shows nodes that flipped visible', async () => {
      const { component, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'a.md' }],
        isIgnored: () => false
      });

      await component.applyDelta([
        { isFolder: false, isVisible: false, path: 'gone.md' },
        { isFolder: false, isVisible: true, path: 'back.md' }
      ]);

      expect(mockAdapter.reconcileDeletion).toHaveBeenCalledExactlyOnceWith('gone.md', 'gone.md');
      expect(mockAdapter.reconcileFile).toHaveBeenCalledExactlyOnceWith('back.md', 'back.md');
    });

    it('routes flips through the files pane in FilesPane mode', async () => {
      const { addToFilesPane, component, deleteFromFilesPane } = setup({
        entries: [{ isFolderFlag: false, path: 'a.md' }],
        excludeMode: ExcludeMode.FilesPane,
        isIgnored: () => false
      });

      await component.applyDelta([
        { isFolder: false, isVisible: false, path: 'gone.md' },
        { isFolder: false, isVisible: true, path: 'back.md' }
      ]);

      expect(deleteFromFilesPane).toHaveBeenCalledExactlyOnceWith('gone.md');
      expect(addToFilesPane).toHaveBeenCalledExactlyOnceWith('back.md');
    });
  });

  describe('update', () => {
    it('rebuilds the model and projects the hidden set', async () => {
      const { component, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md'
      });

      await component.update();

      expect(mockAdapter.reconcileDeletion).toHaveBeenCalledExactlyOnceWith('drop.md', 'drop.md');
    });

    it('aborts a previous in-flight update when called again', async () => {
      const { component, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md'
      });

      let resolveDeletion: (() => void) | undefined;
      mockAdapter.reconcileDeletion.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveDeletion = resolve;
        })
      );

      const firstUpdate = component.update();
      const secondUpdate = component.update();
      ensureNonNullable(resolveDeletion)();
      await Promise.all([firstUpdate, secondUpdate]);

      expect(mockAdapter.reconcileDeletion).toHaveBeenCalled();
    });

    it('re-shows files that became visible and hides newly-ignored ones on a later update', async () => {
      const ignored = new Set<string>(['drop.md']);
      const { component, mockAdapter } = setup({
        entries: [
          { isFolderFlag: false, path: 'drop.md' },
          { isFolderFlag: false, path: 'keep.md' }
        ],
        isIgnored: (path) => ignored.has(path)
      });

      await component.update();
      mockAdapter.reconcileDeletion.mockClear();
      mockAdapter.reconcileFile.mockClear();

      ignored.delete('drop.md');
      ignored.add('keep.md');
      await component.update();

      expect(mockAdapter.reconcileFile).toHaveBeenCalledExactlyOnceWith('drop.md', 'drop.md');
      expect(mockAdapter.reconcileDeletion).toHaveBeenCalledExactlyOnceWith('keep.md', 'keep.md');
    });
  });

  describe('applyDelta abort', () => {
    it('does nothing when the abort signal is already aborted', async () => {
      const { component, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'a.md' }],
        isIgnored: () => false
      });

      const controller = new AbortController();
      controller.abort();
      await component.applyDelta([{ isFolder: false, isVisible: false, path: 'gone.md' }], controller.signal);

      expect(mockAdapter.reconcileDeletion).not.toHaveBeenCalled();
    });
  });

  describe('applyFull abort', () => {
    it('does nothing when the abort signal is already aborted', async () => {
      const { component, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md'
      });

      const controller = new AbortController();
      controller.abort();
      await component.applyFull(controller.signal);

      expect(mockAdapter.reconcileDeletion).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    it('projects on load', async () => {
      const { component, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md'
      });

      await component.loadWithPromises();

      expect(mockAdapter.reconcileDeletion).toHaveBeenCalledWith('drop.md', 'drop.md');
    });

    it('projects on layout ready when the vault load was not intercepted', async () => {
      const { component, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md',
        vaultLoadCalled: false
      });

      await component.onLayoutReady();

      expect(mockAdapter.reconcileDeletion).toHaveBeenCalledWith('drop.md', 'drop.md');
    });

    it('skips projecting on layout ready when the vault load was intercepted', async () => {
      const { component, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md',
        vaultLoadCalled: true
      });

      await component.onLayoutReady();

      expect(mockAdapter.reconcileDeletion).not.toHaveBeenCalled();
    });
  });

  describe('onunload', () => {
    it('is a no-op when no update is in flight', () => {
      const { component } = setup({
        entries: [{ isFolderFlag: false, path: 'a.md' }],
        isIgnored: () => false
      });

      expect(() => {
        component.onunload();
      }).not.toThrow();
    });

    it('aborts an in-flight update', async () => {
      const { component, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md'
      });

      let resolveDeletion: (() => void) | undefined;
      mockAdapter.reconcileDeletion.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveDeletion = resolve;
        })
      );

      const updatePromise = component.update();
      component.onunload();
      ensureNonNullable(resolveDeletion)();
      await updatePromise;

      expect(mockAdapter.reconcileDeletion).toHaveBeenCalledExactlyOnceWith('drop.md', 'drop.md');
    });
  });

  describe('recordCreate / recordDelete', () => {
    it('records a created path into the model and removes it on delete', () => {
      const { component } = setup({
        entries: [{ isFolderFlag: false, path: 'a.md' }],
        isIgnored: () => false
      });

      component.recordCreate('new/file.md', false);
      expect(component.model.isKnown('new/file.md')).toBe(true);

      component.recordDelete('new/file.md');
      expect(component.model.isKnown('new/file.md')).toBe(false);
    });
  });
});
