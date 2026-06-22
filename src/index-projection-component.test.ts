import type { DataAdapterEx } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  TAbstractFile
} from 'obsidian';

import { getDataAdapterEx } from '@obsidian-typings/obsidian-public-latest/implementations';
import { isFolder } from 'obsidian-dev-utils/obsidian/file-system';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import type { VaultLoadPatchComponent } from './patches/vault-load-patch-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type { UpdateProgressNoticeComponent } from './update-progress-notice-component.ts';

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
  readonly persistedEntries?: readonly MockEntry[];
  readonly vaultLoadCalled?: boolean;
}

interface SetupResult {
  readonly addToFilesPane: ReturnType<typeof vi.fn>;
  readonly app: App;
  readonly component: IndexProjectionComponent;
  readonly deleteFromFilesPane: ReturnType<typeof vi.fn>;
  fireWorkspaceLayoutReady(): void;
  readonly mockAdapter: MockAdapter;
  readonly save: ReturnType<typeof vi.fn>;
  readonly updateRelatedLinks: ReturnType<typeof vi.fn>;
}

function setup(params: SetupParams): SetupResult {
  const { entries, excludeMode = ExcludeMode.Full, isIgnored, persistedEntries = [], vaultLoadCalled = false } = params;

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

  let workspaceLayoutReadyCallback: (() => void) | undefined;
  const updateRelatedLinks = vi.fn();
  const app = strictProxy<App>({
    metadataCache: {
      updateRelatedLinks
    },
    vault: {
      getAllLoadedFiles: vi.fn().mockReturnValue(loadedFiles)
    },
    workspace: {
      onLayoutReady: vi.fn((callback: () => void) => {
        workspaceLayoutReadyCallback = callback;
      })
    }
  });

  const ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
    isIgnored: vi.fn((normalizedPath: string) => isIgnored(normalizedPath))
  });

  const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
    settings: { excludeMode }
  });

  const vaultLoadPatch = strictProxy<VaultLoadPatchComponent>({ vaultLoadCalled });

  const persisted = persistedEntries.map((entry) => ({ isFolder: entry.isFolderFlag, path: entry.path }));
  const save = vi.fn();
  const vaultPathStore = {
    load: vi.fn().mockResolvedValue(persisted),
    save
  };

  const addToFilesPane = vi.fn();
  const deleteFromFilesPane = vi.fn();

  const updateProgressNotice = strictProxy<UpdateProgressNoticeComponent>({
    finish: vi.fn(),
    report: vi.fn(),
    start: vi.fn()
  });

  const component = new IndexProjectionComponent({
    addToFilesPane,
    app,
    deleteFromFilesPane,
    ignorePatternsComponent,
    pluginSettingsComponent,
    updateProgressNotice,
    vaultLoadPatch,
    vaultPathStore
  });

  return { addToFilesPane, app, component, deleteFromFilesPane, fireWorkspaceLayoutReady, mockAdapter, save, updateRelatedLinks };

  function fireWorkspaceLayoutReady(): void {
    workspaceLayoutReadyCallback?.();
  }
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

  describe('applyFull persisted restore', () => {
    it('re-adds a persisted file that is now visible but missing from the index', async () => {
      const { component, mockAdapter, save } = setup({
        entries: [
          { isFolderFlag: false, path: 'alpha.md' },
          { isFolderFlag: false, path: 'gamma.md' }
        ],
        // Beta was hidden by a prior session: persisted, not in the loaded index.
        isIgnored: (path) => path === 'gamma.md',
        persistedEntries: [{ isFolderFlag: false, path: 'beta.md' }]
      });

      await component.applyFull();

      // Gamma is now ignored -> removed; beta is visible but missing -> re-added.
      expect(mockAdapter.reconcileDeletion).toHaveBeenCalledWith('gamma.md', 'gamma.md');
      expect(mockAdapter.reconcileFile).toHaveBeenCalledWith('beta.md', 'beta.md');
      expect(save).toHaveBeenCalled();
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

      // Both calls are in flight at the async model rebuild; the second aborts the
      // First, so the first never reaches its reconcile step.
      const firstUpdate = component.update();
      const secondUpdate = component.update();
      await Promise.all([firstUpdate, secondUpdate]);

      expect(mockAdapter.reconcileDeletion).not.toHaveBeenCalled();
    });

    it('skips applying the delta when superseded mid-recompute', async () => {
      const ignored = new Set<string>();
      const { component, mockAdapter } = setup({
        entries: [
          { isFolderFlag: true, path: 'a' },
          { isFolderFlag: false, path: 'a/x.md' }
        ],
        isIgnored: (path) => ignored.has(path) || [...ignored].some((prefix) => path.startsWith(`${prefix}/`))
      });

      // Build the model first so a later update takes the incremental delta path.
      await component.update();
      mockAdapter.reconcileDeletion.mockClear();

      ignored.add('a');
      // Two deltas in flight: the second aborts the first after its recompute, so the
      // First returns without applying — only the second hides the subtree.
      const firstUpdate = component.update();
      const secondUpdate = component.update();
      await Promise.all([firstUpdate, secondUpdate]);

      expect(mockAdapter.reconcileDeletion).toHaveBeenCalledExactlyOnceWith('a', 'a');
    });

    it('hides only the hide-root of a newly-ignored subtree, relying on cascade', async () => {
      const ignored = new Set<string>();
      const { component, mockAdapter } = setup({
        entries: [
          { isFolderFlag: true, path: 'a' },
          { isFolderFlag: false, path: 'a/x.md' },
          { isFolderFlag: false, path: 'a/y.md' }
        ],
        isIgnored: (path) => ignored.has(path) || [...ignored].some((prefix) => path.startsWith(`${prefix}/`))
      });

      await component.update();
      mockAdapter.reconcileDeletion.mockClear();

      ignored.add('a');
      await component.update();

      // The whole subtree flips hidden, but only the folder is removed — its
      // Descendants are cascaded by `reconcileDeletion`, not deleted one by one.
      expect(mockAdapter.reconcileDeletion).toHaveBeenCalledExactlyOnceWith('a', 'a');
    });

    it('shows a re-included subtree parent-first so folders exist before their files', async () => {
      const ignored = new Set<string>(['a', 'a/x.md']);
      const { component, mockAdapter } = setup({
        entries: [
          { isFolderFlag: true, path: 'a' },
          { isFolderFlag: false, path: 'a/x.md' }
        ],
        isIgnored: (path) => ignored.has(path)
      });

      await component.update();
      mockAdapter.reconcileFile.mockClear();

      ignored.clear();
      await component.update();

      expect(mockAdapter.reconcileFile).toHaveBeenNthCalledWith(1, 'a', 'a');
      expect(mockAdapter.reconcileFile).toHaveBeenNthCalledWith(2, 'a/x.md', 'a/x.md');
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

  describe('updateRelatedLinks batching', () => {
    it('collects the cascade\'s per-file updateRelatedLinks into one call after a Full-mode hide', async () => {
      const { app, component, mockAdapter, updateRelatedLinks } = setup({
        entries: [
          { isFolderFlag: true, path: 'a' },
          { isFolderFlag: false, path: 'a/x.md' }
        ],
        isIgnored: (path) => path === 'a' || path.startsWith('a/')
      });

      /*
       * Simulate Obsidian's cascade: a folder reconcileDeletion fires
       * updateRelatedLinks once per removed descendant (the O(N²) source). While
       * the projection runs these are collected, not run.
       */
      mockAdapter.reconcileDeletion.mockImplementation((path: string) => {
        app.metadataCache.updateRelatedLinks([path]);
        app.metadataCache.updateRelatedLinks([`${path}/x.md`]);
      });

      await component.update();

      /*
       * One reconcileDeletion (the hide-root), two collected names, one real call
       * afterwards with their union.
       */
      expect(updateRelatedLinks).toHaveBeenCalledExactlyOnceWith(['a', 'a/x.md']);
    });

    it('does not touch updateRelatedLinks in FilesPane mode', async () => {
      const { component, updateRelatedLinks } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        excludeMode: ExcludeMode.FilesPane,
        isIgnored: (path) => path === 'drop.md'
      });

      await component.update();

      expect(updateRelatedLinks).not.toHaveBeenCalled();
    });
  });

  describe('isApplyingProjection', () => {
    it('is true while reconciling and false before and after', async () => {
      let observedDuringReconcile: boolean | undefined;
      const { component, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md'
      });
      mockAdapter.reconcileDeletion.mockImplementation(() => {
        observedDuringReconcile = component.isApplyingProjection;
      });

      expect(component.isApplyingProjection).toBe(false);
      await component.update();

      expect(observedDuringReconcile).toBe(true);
      expect(component.isApplyingProjection).toBe(false);
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

    it('shows nothing when the abort signal is already aborted', async () => {
      const { component, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'a.md' }],
        isIgnored: () => false
      });

      const controller = new AbortController();
      controller.abort();
      await component.applyDelta([{ isFolder: false, isVisible: true, path: 'back.md' }], controller.signal);

      expect(mockAdapter.reconcileFile).not.toHaveBeenCalled();
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

    it('stops the re-add pass when the abort signal is already aborted', async () => {
      const { component, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'alpha.md' }],
        // Nothing ignored, so the hide loop is empty and the abort is hit in the re-add pass.
        isIgnored: () => false,
        persistedEntries: [{ isFolderFlag: false, path: 'beta.md' }]
      });

      const controller = new AbortController();
      controller.abort();
      await component.applyFull(controller.signal);

      expect(mockAdapter.reconcileFile).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('projects on load', async () => {
      const { component, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md'
      });

      // The apply phase yields a (faked) macrotask between reconciles, so advance
      // Timers to let the load-time projection finish.
      const loadPromise = component.loadWithPromises();
      await vi.runAllTimersAsync();
      await loadPromise;

      expect(mockAdapter.reconcileDeletion).toHaveBeenCalledWith('drop.md', 'drop.md');
    });

    it('projects on layout ready when the vault load was not intercepted', async () => {
      const ignored = new Set<string>();
      const { component, fireWorkspaceLayoutReady, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => ignored.has(path),
        vaultLoadCalled: false
      });

      // Loading runs the onloadAsync projection (nothing ignored yet, so no reconcile)
      // And registers the real layout-ready child; clear so the assertion only sees
      // The layout-ready projection.
      await component.loadWithPromises();
      mockAdapter.reconcileDeletion.mockClear();

      // Flip the file hidden, then fire layout ready: since the vault load was not
      // Intercepted, onLayoutReady runs a second projection that hides it.
      ignored.add('drop.md');
      fireWorkspaceLayoutReady();
      await vi.runAllTimersAsync();

      expect(mockAdapter.reconcileDeletion).toHaveBeenCalledWith('drop.md', 'drop.md');
    });

    it('skips projecting on layout ready when the vault load was intercepted', async () => {
      const ignored = new Set<string>();
      const { component, fireWorkspaceLayoutReady, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => ignored.has(path),
        vaultLoadCalled: true
      });

      await component.loadWithPromises();
      mockAdapter.reconcileDeletion.mockClear();

      // Flip the file hidden, but since the vault load was intercepted, onLayoutReady
      // Skips its projection entirely — no reconcile happens despite the flip.
      ignored.add('drop.md');
      fireWorkspaceLayoutReady();
      await vi.runAllTimersAsync();

      expect(mockAdapter.reconcileDeletion).not.toHaveBeenCalled();
    });
  });

  describe('onunload', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('is a no-op when no update is in flight', async () => {
      const { component } = setup({
        entries: [{ isFolderFlag: false, path: 'a.md' }],
        isIgnored: () => false
      });

      // Load fully (no update is left in flight), then unload runs the real onunload.
      await component.loadWithPromises();
      await vi.runAllTimersAsync();

      expect(() => {
        component.unload();
      }).not.toThrow();
    });

    it('aborts an in-flight update', async () => {
      const { component, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md'
      });

      // The load-time projection is in flight at the async model rebuild (parked on
      // The persisted-path-store load); unload aborts it before it reconciles.
      const loadPromise = component.loadWithPromises();
      component.unload();
      await loadPromise;
      await vi.runAllTimersAsync();

      expect(mockAdapter.reconcileDeletion).not.toHaveBeenCalled();
    });
  });

  describe('getHiddenCount', () => {
    it('returns the number of hidden paths', async () => {
      const { component } = setup({
        entries: [
          { isFolderFlag: false, path: 'drop.md' },
          { isFolderFlag: false, path: 'keep.md' }
        ],
        isIgnored: (path) => path === 'drop.md'
      });

      await component.applyFull();

      expect(component.getHiddenCount()).toBe(1);
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
