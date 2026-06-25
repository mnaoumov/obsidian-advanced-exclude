import type { DataAdapterEx } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  TAbstractFile
} from 'obsidian';
import type { Mock } from 'vitest';

import { getDataAdapterEx } from '@obsidian-typings/obsidian-public-latest/implementations';
import { castTo } from 'obsidian-dev-utils/object-utils';
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
import type {
  ManualIndexHider,
  SnapshotStat
} from './manual-index-hider.ts';
import type { VaultLoadPatchComponent } from './patches/vault-load-patch-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type { UpdateProgressNoticeComponent } from './update-progress-notice-component.ts';
import type { VaultModel } from './vault-model.ts';

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

// The disk stat a fresh (non-stale) snapshot matches: getSnapshotStat and adapter.stat
// Both return this by default, so the staleness check finds the snapshot up to date.
const FRESH_STAT = { mtime: 1000, size: 50 };

interface MockAdapter {
  files: DataAdapterEx['files'];
  reconcileFile: ReturnType<typeof vi.fn>;
  stat: ReturnType<typeof vi.fn>;
}

interface MockEntry {
  isFolderFlag: boolean;
  path: string;
}

interface MockManualIndexHider {
  dropStaleSnapshot: Mock<(normalizedPath: string) => void>;
  getSnapshotStat: Mock<(normalizedPath: string) => null | SnapshotStat>;
  hasSnapshot: Mock<(normalizedPath: string) => boolean>;
  hide: Mock<(normalizedPaths: readonly string[]) => void>;
  show: Mock<(normalizedPaths: readonly string[]) => string[]>;
}

interface SetupParams {
  readonly entries: readonly MockEntry[];
  readonly excludeMode?: ExcludeMode;
  isIgnored(normalizedPath: string): boolean;
  readonly persistedEntries?: readonly MockEntry[];
  readonly vaultLoadCalled?: boolean;
}

interface SetupResult {
  readonly addToFilesPane: Mock<(normalizedPath: string) => void>;
  readonly app: App;
  readonly component: IndexProjectionComponent;
  readonly deleteFromFilesPane: Mock<(normalizedPath: string) => void>;
  fireWorkspaceLayoutReady(): void;
  readonly manualIndexHider: MockManualIndexHider;
  readonly mockAdapter: MockAdapter;
  readonly save: ReturnType<typeof vi.fn>;
}

interface TestableIndexProjectionComponent {
  readonly vaultModel: VaultModel;
}

/**
 * The paths passed to the single batched `manualIndexHider.hide` call, sorted so
 * assertions do not depend on the deepest-first traversal order.
 */
function hiddenPaths(manualIndexHider: MockManualIndexHider): string[] {
  expect(manualIndexHider.hide).toHaveBeenCalledTimes(1);
  const [paths] = manualIndexHider.hide.mock.calls[0] as [readonly string[]];
  return [...paths].sort();
}

function setup(params: SetupParams): SetupResult {
  const { entries, excludeMode = ExcludeMode.Full, isIgnored, persistedEntries = [], vaultLoadCalled = false } = params;

  // Mirror the real adapter: its internal stat record lists every path on disk —
  // The loaded entries plus any persisted (prior-session-hidden, still-on-disk) paths.
  const files: DataAdapterEx['files'] = {};
  for (const entry of [...entries, ...persistedEntries]) {
    files[entry.path] = strictProxy<DataAdapterEx['files'][string]>({});
  }
  const mockAdapter: MockAdapter = {
    files,
    reconcileFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue(FRESH_STAT)
  };
  const dataAdapterEx = strictProxy<DataAdapterEx>({});
  Object.assign(dataAdapterEx, mockAdapter);
  mockGetDataAdapterEx.mockReturnValue(dataAdapterEx);

  const loadedFiles = entries.map((entry) => strictProxy<TAbstractFile>({ path: entry.path }));
  const flagByPath = new Map(entries.map((entry) => [entry.path, entry.isFolderFlag]));
  mockIsFolder.mockImplementation((file) => flagByPath.get((file as TAbstractFile).path) ?? false);

  let workspaceLayoutReadyCallback: (() => void) | undefined;
  const app = strictProxy<App>({
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

  const addToFilesPane = vi.fn<(normalizedPath: string) => void>();
  const deleteFromFilesPane = vi.fn<(normalizedPath: string) => void>();

  // Snapshot-backed restore is the default (show finds a snapshot, returns no
  // Re-parse paths); tests that exercise the re-parse fallback override `show`.
  // The default snapshot is fresh: getSnapshotStat matches the adapter's disk stat,
  // So the staleness check leaves the snapshot in place.
  const manualIndexHider: MockManualIndexHider = {
    dropStaleSnapshot: vi.fn<(normalizedPath: string) => void>(),
    getSnapshotStat: vi.fn<(normalizedPath: string) => null | SnapshotStat>().mockReturnValue(FRESH_STAT),
    hasSnapshot: vi.fn<(normalizedPath: string) => boolean>().mockReturnValue(true),
    hide: vi.fn<(normalizedPaths: readonly string[]) => void>(),
    show: vi.fn<(normalizedPaths: readonly string[]) => string[]>().mockReturnValue([])
  };

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
    manualIndexHider: strictProxy<ManualIndexHider>({
      dropStaleSnapshot: manualIndexHider.dropStaleSnapshot,
      getSnapshotStat: manualIndexHider.getSnapshotStat,
      hasSnapshot: manualIndexHider.hasSnapshot,
      hide: manualIndexHider.hide,
      show: manualIndexHider.show
    }),
    pluginSettingsComponent,
    updateProgressNotice,
    vaultLoadPatch,
    vaultPathStore
  });

  return { addToFilesPane, app, component, deleteFromFilesPane, fireWorkspaceLayoutReady, manualIndexHider, mockAdapter, save };

  function fireWorkspaceLayoutReady(): void {
    workspaceLayoutReadyCallback?.();
  }
}

describe('IndexProjectionComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('applyFull (Full mode)', () => {
    it('removes the whole hidden subtree from the index in one batched call and drives the explorer', async () => {
      const { component, deleteFromFilesPane, manualIndexHider } = setup({
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

      expect(hiddenPaths(manualIndexHider)).toEqual(['a', 'a/x.md', 'a/y.md']);
      expect(deleteFromFilesPane.mock.calls.map((call) => call[0]).sort()).toEqual(['a', 'a/x.md', 'a/y.md']);
      expect(castTo<TestableIndexProjectionComponent>(component).vaultModel.isVisible('a/x.md')).not.toBeUndefined();
    });

    it('removes an individually-ignored file from a visible folder', async () => {
      const { component, deleteFromFilesPane, manualIndexHider } = setup({
        entries: [
          { isFolderFlag: true, path: 'a' },
          { isFolderFlag: false, path: 'a/keep.md' },
          { isFolderFlag: false, path: 'a/drop.md' }
        ],
        isIgnored: (path) => path === 'a/drop.md'
      });

      await component.applyFull();

      expect(hiddenPaths(manualIndexHider)).toEqual(['a/drop.md']);
      expect(deleteFromFilesPane).toHaveBeenCalledExactlyOnceWith('a/drop.md');
    });

    it('removes nothing when nothing is ignored', async () => {
      const { component, deleteFromFilesPane, manualIndexHider } = setup({
        entries: [{ isFolderFlag: false, path: 'a.md' }],
        isIgnored: () => false
      });

      await component.applyFull();

      expect(manualIndexHider.hide).not.toHaveBeenCalled();
      expect(deleteFromFilesPane).not.toHaveBeenCalled();
    });
  });

  describe('applyFull persisted restore', () => {
    it('re-adds a persisted file that is now visible but missing from the index via a re-parse', async () => {
      const { component, manualIndexHider, mockAdapter, save } = setup({
        entries: [
          { isFolderFlag: false, path: 'alpha.md' },
          { isFolderFlag: false, path: 'gamma.md' }
        ],
        // Beta was hidden by a prior session: persisted, not in the loaded index.
        isIgnored: (path) => path === 'gamma.md',
        persistedEntries: [{ isFolderFlag: false, path: 'beta.md' }]
      });
      // Beta has no in-session snapshot, so the show falls back to a re-parse.
      manualIndexHider.show.mockReturnValue(['beta.md']);

      await component.applyFull();

      expect(hiddenPaths(manualIndexHider)).toEqual(['gamma.md']);
      expect(mockAdapter.reconcileFile).toHaveBeenCalledWith('beta.md', 'beta.md');
      expect(save).toHaveBeenCalled();
    });

    it('invalidates the adapter stat record before the re-parse so a snapshot-less file is re-added', async () => {
      const { component, manualIndexHider, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'alpha.md' }],
        isIgnored: () => false,
        persistedEntries: [{ isFolderFlag: false, path: 'beta.md' }]
      });
      manualIndexHider.show.mockReturnValue(['beta.md']);
      // The adapter still holds a stale record for beta from the prior-session hide;
      // Without dropping it first, `reconcileFile` would see no change and re-add nothing.
      expect('beta.md' in mockAdapter.files).toBe(true);

      await component.applyFull();

      expect(mockAdapter.reconcileFile).toHaveBeenCalledWith('beta.md', 'beta.md');
      // The stale record was dropped so the re-parse treats the on-disk file as new.
      expect('beta.md' in mockAdapter.files).toBe(false);
    });
  });

  describe('applyFull (FilesPane mode)', () => {
    it('removes every hidden node from the files pane and touches neither the index nor the adapter', async () => {
      const { component, deleteFromFilesPane, manualIndexHider, mockAdapter } = setup({
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
      expect(manualIndexHider.hide).not.toHaveBeenCalled();
      expect(mockAdapter.reconcileFile).not.toHaveBeenCalled();
    });
  });

  describe('applyDelta', () => {
    it('hides nodes that flipped hidden and shows nodes that flipped visible', async () => {
      const { addToFilesPane, component, deleteFromFilesPane, manualIndexHider } = setup({
        entries: [{ isFolderFlag: false, path: 'a.md' }],
        isIgnored: () => false
      });

      await component.applyDelta([
        { isFolder: false, isVisible: false, path: 'gone.md' },
        { isFolder: false, isVisible: true, path: 'back.md' }
      ]);

      expect(deleteFromFilesPane).toHaveBeenCalledExactlyOnceWith('gone.md');
      expect(hiddenPaths(manualIndexHider)).toEqual(['gone.md']);
      // Back.md restores from its snapshot, so the explorer is driven directly.
      expect(addToFilesPane).toHaveBeenCalledExactlyOnceWith('back.md');
    });

    it('re-parses a shown file that has no snapshot', async () => {
      const { addToFilesPane, component, manualIndexHider, mockAdapter } = setup({
        entries: [{ isFolderFlag: false, path: 'a.md' }],
        isIgnored: () => false
      });
      manualIndexHider.show.mockReturnValue(['back.md']);

      await component.applyDelta([{ isFolder: false, isVisible: true, path: 'back.md' }]);

      expect(mockAdapter.reconcileFile).toHaveBeenCalledExactlyOnceWith('back.md', 'back.md');
      expect(addToFilesPane).not.toHaveBeenCalled();
    });

    it('keeps progressing when the window is hidden (no paint frame arrives)', async () => {
      const { component, deleteFromFilesPane, manualIndexHider } = setup({
        entries: [{ isFolderFlag: false, path: 'a.md' }],
        isIgnored: () => false
      });
      // Simulate an unfocused/hidden window: requestAnimationFrame never fires its
      // Callback, so the projection must fall back to the timeout to keep going.
      const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);

      try {
        await component.applyDelta([{ isFolder: false, isVisible: false, path: 'gone.md' }]);
      } finally {
        requestAnimationFrameSpy.mockRestore();
      }

      expect(deleteFromFilesPane).toHaveBeenCalledExactlyOnceWith('gone.md');
      expect(hiddenPaths(manualIndexHider)).toEqual(['gone.md']);
    });

    it('routes flips through the files pane in FilesPane mode', async () => {
      const { addToFilesPane, component, deleteFromFilesPane, manualIndexHider } = setup({
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
      expect(manualIndexHider.hide).not.toHaveBeenCalled();
      expect(manualIndexHider.show).not.toHaveBeenCalled();
    });
  });

  describe('stale snapshot invalidation (Full mode show)', () => {
    function showBack(): ReturnType<typeof setup> {
      return setup({ entries: [{ isFolderFlag: false, path: 'a.md' }], isIgnored: () => false });
    }

    it('restores from the snapshot when the file is unchanged on disk', async () => {
      const { addToFilesPane, component, manualIndexHider, mockAdapter } = showBack();

      await component.applyDelta([{ isFolder: false, isVisible: true, path: 'back.md' }]);

      expect(mockAdapter.stat).toHaveBeenCalledExactlyOnceWith('back.md');
      expect(manualIndexHider.dropStaleSnapshot).not.toHaveBeenCalled();
      expect(addToFilesPane).toHaveBeenCalledExactlyOnceWith('back.md');
    });

    it('drops the snapshot and re-parses when the mtime changed while hidden', async () => {
      const { component, manualIndexHider, mockAdapter } = showBack();
      mockAdapter.stat.mockResolvedValue({ mtime: 2000, size: 50 });
      manualIndexHider.show.mockReturnValue(['back.md']);

      await component.applyDelta([{ isFolder: false, isVisible: true, path: 'back.md' }]);

      expect(manualIndexHider.dropStaleSnapshot).toHaveBeenCalledExactlyOnceWith('back.md');
      expect(mockAdapter.reconcileFile).toHaveBeenCalledExactlyOnceWith('back.md', 'back.md');
    });

    it('drops the snapshot when only the size changed while hidden', async () => {
      const { component, manualIndexHider, mockAdapter } = showBack();
      mockAdapter.stat.mockResolvedValue({ mtime: 1000, size: 99 });
      manualIndexHider.show.mockReturnValue(['back.md']);

      await component.applyDelta([{ isFolder: false, isVisible: true, path: 'back.md' }]);

      expect(manualIndexHider.dropStaleSnapshot).toHaveBeenCalledExactlyOnceWith('back.md');
    });

    it('does not stat or drop when the path is a folder', async () => {
      const { addToFilesPane, component, manualIndexHider, mockAdapter } = showBack();

      await component.applyDelta([{ isFolder: true, isVisible: true, path: 'folder' }]);

      expect(mockAdapter.stat).not.toHaveBeenCalled();
      expect(manualIndexHider.hasSnapshot).not.toHaveBeenCalled();
      expect(addToFilesPane).toHaveBeenCalledExactlyOnceWith('folder');
    });

    it('does not stat when no snapshot is held (prior-session hide)', async () => {
      const { component, manualIndexHider, mockAdapter } = showBack();
      manualIndexHider.hasSnapshot.mockReturnValue(false);

      await component.applyDelta([{ isFolder: false, isVisible: true, path: 'back.md' }]);

      expect(manualIndexHider.getSnapshotStat).not.toHaveBeenCalled();
      expect(mockAdapter.stat).not.toHaveBeenCalled();
    });

    it('does not stat when the snapshot carries no captured stat', async () => {
      const { component, manualIndexHider, mockAdapter } = showBack();
      manualIndexHider.getSnapshotStat.mockReturnValue(null);

      await component.applyDelta([{ isFolder: false, isVisible: true, path: 'back.md' }]);

      expect(mockAdapter.stat).not.toHaveBeenCalled();
      expect(manualIndexHider.dropStaleSnapshot).not.toHaveBeenCalled();
    });

    it('keeps the snapshot when the file is gone from disk (stat returns null)', async () => {
      const { addToFilesPane, component, manualIndexHider, mockAdapter } = showBack();
      mockAdapter.stat.mockResolvedValue(null);

      await component.applyDelta([{ isFolder: false, isVisible: true, path: 'back.md' }]);

      expect(manualIndexHider.dropStaleSnapshot).not.toHaveBeenCalled();
      expect(addToFilesPane).toHaveBeenCalledExactlyOnceWith('back.md');
    });
  });

  describe('update', () => {
    it('rebuilds the model and projects the hidden set', async () => {
      const { component, deleteFromFilesPane, manualIndexHider } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md'
      });

      await component.update();

      expect(hiddenPaths(manualIndexHider)).toEqual(['drop.md']);
      expect(deleteFromFilesPane).toHaveBeenCalledExactlyOnceWith('drop.md');
    });

    it('aborts a previous in-flight update when called again', async () => {
      const { component, manualIndexHider } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md'
      });

      // Both calls are the first (model-building) projection. The second aborts the
      // First before its rebuild finishes, then takes the delta branch over the
      // Still-empty model — so neither projection hides anything.
      const firstUpdate = component.update();
      const secondUpdate = component.update();
      await Promise.all([firstUpdate, secondUpdate]);

      expect(manualIndexHider.hide).not.toHaveBeenCalled();
    });

    it('skips applying the delta when superseded mid-recompute', async () => {
      const ignored = new Set<string>();
      const { component, manualIndexHider } = setup({
        entries: [
          { isFolderFlag: true, path: 'a' },
          { isFolderFlag: false, path: 'a/x.md' }
        ],
        isIgnored: (path) => ignored.has(path) || [...ignored].some((prefix) => path.startsWith(`${prefix}/`))
      });

      // Build the model first so a later update takes the incremental delta path.
      await component.update();
      manualIndexHider.hide.mockClear();

      ignored.add('a');
      // Two deltas in flight: the second aborts the first after its recompute, so the
      // First returns without applying — only the second hides the subtree.
      const firstUpdate = component.update();
      const secondUpdate = component.update();
      await Promise.all([firstUpdate, secondUpdate]);

      expect(hiddenPaths(manualIndexHider)).toEqual(['a', 'a/x.md']);
    });

    it('hides the whole newly-ignored subtree in one batched, event-free call', async () => {
      const ignored = new Set<string>();
      const { component, deleteFromFilesPane, manualIndexHider } = setup({
        entries: [
          { isFolderFlag: true, path: 'a' },
          { isFolderFlag: false, path: 'a/x.md' },
          { isFolderFlag: false, path: 'a/y.md' }
        ],
        isIgnored: (path) => ignored.has(path) || [...ignored].some((prefix) => path.startsWith(`${prefix}/`))
      });

      await component.update();
      manualIndexHider.hide.mockClear();
      deleteFromFilesPane.mockClear();

      ignored.add('a');
      await component.update();

      // The whole subtree flips hidden; every path is removed (no cascade to rely on).
      expect(hiddenPaths(manualIndexHider)).toEqual(['a', 'a/x.md', 'a/y.md']);
      expect(deleteFromFilesPane.mock.calls.map((call) => call[0]).sort()).toEqual(['a', 'a/x.md', 'a/y.md']);
    });

    it('shows a re-included subtree parent-first so folders exist before their files', async () => {
      const ignored = new Set<string>(['a', 'a/x.md']);
      const { addToFilesPane, component } = setup({
        entries: [
          { isFolderFlag: true, path: 'a' },
          { isFolderFlag: false, path: 'a/x.md' }
        ],
        isIgnored: (path) => ignored.has(path)
      });

      await component.update();
      addToFilesPane.mockClear();

      ignored.clear();
      await component.update();

      expect(addToFilesPane).toHaveBeenNthCalledWith(1, 'a');
      expect(addToFilesPane).toHaveBeenNthCalledWith(2, 'a/x.md');
    });

    it('re-shows files that became visible and hides newly-ignored ones on a later update', async () => {
      const ignored = new Set<string>(['drop.md']);
      const { addToFilesPane, component, deleteFromFilesPane, manualIndexHider } = setup({
        entries: [
          { isFolderFlag: false, path: 'drop.md' },
          { isFolderFlag: false, path: 'keep.md' }
        ],
        isIgnored: (path) => ignored.has(path)
      });

      await component.update();
      manualIndexHider.hide.mockClear();
      addToFilesPane.mockClear();
      deleteFromFilesPane.mockClear();

      ignored.delete('drop.md');
      ignored.add('keep.md');
      await component.update();

      expect(addToFilesPane).toHaveBeenCalledExactlyOnceWith('drop.md');
      expect(hiddenPaths(manualIndexHider)).toEqual(['keep.md']);
      expect(deleteFromFilesPane).toHaveBeenCalledExactlyOnceWith('keep.md');
    });
  });

  describe('isApplyingProjection', () => {
    it('is true while applying and false before and after', async () => {
      let observedDuringHide: boolean | undefined;
      const { component, manualIndexHider } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md'
      });
      manualIndexHider.hide.mockImplementation(() => {
        observedDuringHide = component.isApplyingProjection;
      });

      expect(component.isApplyingProjection).toBe(false);
      await component.update();

      expect(observedDuringHide).toBe(true);
      expect(component.isApplyingProjection).toBe(false);
    });
  });

  describe('applyDelta abort', () => {
    it('does nothing when the abort signal is already aborted', async () => {
      const { component, manualIndexHider } = setup({
        entries: [{ isFolderFlag: false, path: 'a.md' }],
        isIgnored: () => false
      });

      const controller = new AbortController();
      controller.abort();
      await component.applyDelta([{ isFolder: false, isVisible: false, path: 'gone.md' }], controller.signal);

      expect(manualIndexHider.hide).not.toHaveBeenCalled();
    });

    it('shows nothing when the abort signal is already aborted', async () => {
      const { addToFilesPane, component, manualIndexHider } = setup({
        entries: [{ isFolderFlag: false, path: 'a.md' }],
        isIgnored: () => false
      });

      const controller = new AbortController();
      controller.abort();
      await component.applyDelta([{ isFolder: false, isVisible: true, path: 'back.md' }], controller.signal);

      expect(manualIndexHider.show).not.toHaveBeenCalled();
      expect(addToFilesPane).not.toHaveBeenCalled();
    });
  });

  describe('applyFull abort', () => {
    it('does nothing when the abort signal is already aborted', async () => {
      const { component, manualIndexHider } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md'
      });

      const controller = new AbortController();
      controller.abort();
      await component.applyFull(controller.signal);

      expect(manualIndexHider.hide).not.toHaveBeenCalled();
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
      const { component, manualIndexHider } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md'
      });

      // The apply phase yields a (faked) macrotask between chunks, so advance timers
      // To let the load-time projection finish.
      const loadPromise = component.loadWithPromises();
      await vi.runAllTimersAsync();
      await loadPromise;

      expect(manualIndexHider.hide).toHaveBeenCalledWith(['drop.md']);
    });

    it('projects on layout ready when the vault load was not intercepted', async () => {
      const ignored = new Set<string>();
      const { component, fireWorkspaceLayoutReady, manualIndexHider } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => ignored.has(path),
        vaultLoadCalled: false
      });

      // Loading runs the onloadAsync projection (nothing ignored yet, so no hide) and
      // Registers the real layout-ready child; clear so the assertion only sees the
      // Layout-ready projection.
      await component.loadWithPromises();
      manualIndexHider.hide.mockClear();

      // Flip the file hidden, then fire layout ready: since the vault load was not
      // Intercepted, onLayoutReady runs a second projection that hides it.
      ignored.add('drop.md');
      fireWorkspaceLayoutReady();
      await vi.runAllTimersAsync();

      expect(manualIndexHider.hide).toHaveBeenCalledWith(['drop.md']);
    });

    it('skips projecting on layout ready when the vault load was intercepted', async () => {
      const ignored = new Set<string>();
      const { component, fireWorkspaceLayoutReady, manualIndexHider } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => ignored.has(path),
        vaultLoadCalled: true
      });

      await component.loadWithPromises();
      manualIndexHider.hide.mockClear();

      // Flip the file hidden, but since the vault load was intercepted, onLayoutReady
      // Skips its projection entirely — no hide happens despite the flip.
      ignored.add('drop.md');
      fireWorkspaceLayoutReady();
      await vi.runAllTimersAsync();

      expect(manualIndexHider.hide).not.toHaveBeenCalled();
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
      const { component, manualIndexHider } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md'
      });

      // The load-time projection is in flight at the async model rebuild (parked on
      // The persisted-path-store load); unload aborts it before it hides.
      const loadPromise = component.loadWithPromises();
      component.unload();
      await loadPromise;
      await vi.runAllTimersAsync();

      expect(manualIndexHider.hide).not.toHaveBeenCalled();
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
      expect(castTo<TestableIndexProjectionComponent>(component).vaultModel.isVisible('new/file.md')).not.toBeUndefined();

      component.recordDelete('new/file.md');
      expect(castTo<TestableIndexProjectionComponent>(component).vaultModel.isVisible('new/file.md')).toBeUndefined();
    });
  });
});
