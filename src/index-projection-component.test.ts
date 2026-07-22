import type { DataAdapterEx } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  EventRef,
  TAbstractFile,
  View,
  WorkspaceLeaf
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
import { computeUniverseSignature } from './universe-signature.ts';

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

interface IsIgnoredParams {
  readonly normalizedPath: string;
}

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
  readonly configUnchanged?: boolean;
  readonly entries: readonly MockEntry[];
  readonly excludeMode?: ExcludeMode;
  isIgnored(normalizedPath: string): boolean;
  readonly persistedEntries?: readonly MockEntry[];
  readonly persistedUniverseSignature?: null | string;
  readonly vaultLoadCalled?: boolean;
}

interface SetupResult {
  readonly addToFilesPane: Mock<(normalizedPath: string) => void>;
  readonly app: App;
  readonly component: IndexProjectionComponent;
  readonly deleteFromFilesPane: Mock<(normalizedPath: string) => void>;
  fireQuit(): void;
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
  const {
    configUnchanged = false,
    entries,
    excludeMode = ExcludeMode.Full,
    isIgnored,
    persistedEntries = [],
    persistedUniverseSignature = null,
    vaultLoadCalled = false
  } = params;

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
  let workspaceQuitCallback: (() => void) | undefined;
  const app = strictProxy<App>({
    vault: {
      getAllLoadedFiles: vi.fn().mockReturnValue(loadedFiles)
    },
    workspace: {
      getLeavesOfType: vi.fn<(viewType: string) => WorkspaceLeaf[]>().mockReturnValue([]),
      // Capture the `'quit'` handler so tests can simulate app shutdown; the returned
      // `EventRef` stub has no `e`, so `registerEvent`'s unload cleanup is a safe no-op.
      on: castTo<App['workspace']['on']>(vi.fn((name: string, callback: () => void) => {
        if (name === 'quit') {
          workspaceQuitCallback = callback;
        }
        // A plain stub (not a strictProxy): `registerEvent`'s unload cleanup reads
        // `ref.e?.offref`, and a strictProxy would throw on the unmocked `e` read.
        return castTo<EventRef>({});
      })),
      onLayoutReady: vi.fn((callback: () => void) => {
        workspaceLayoutReadyCallback = callback;
      })
    }
  });

  const ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
    ensureVerdictsLoaded: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    isConfigUnchanged: vi.fn<() => boolean>().mockReturnValue(configUnchanged),
    isIgnored: vi.fn((isIgnoredParams: IsIgnoredParams) => isIgnored(isIgnoredParams.normalizedPath))
  });

  const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
    settings: { excludeMode, shouldHideEmptyFolders: false }
  });

  const vaultLoadPatch = strictProxy<VaultLoadPatchComponent>({ vaultLoadCalled });

  const persisted = persistedEntries.map((entry) => ({ isFolder: entry.isFolderFlag, path: entry.path }));
  const save = vi.fn();
  const vaultPathStore = {
    load: vi.fn().mockResolvedValue({ entries: persisted, universeSignature: persistedUniverseSignature }),
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

  return { addToFilesPane, app, component, deleteFromFilesPane, fireQuit, fireWorkspaceLayoutReady, manualIndexHider, mockAdapter, save };

  function fireWorkspaceLayoutReady(): void {
    workspaceLayoutReadyCallback?.();
  }

  function fireQuit(): void {
    workspaceQuitCallback?.();
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

  describe('link view refresh (Full mode)', () => {
    function linkLeaf(backlink: View['backlink'], outgoingLink: View['outgoingLink']): WorkspaceLeaf {
      return strictProxy<WorkspaceLeaf>({ view: strictProxy<View>({ backlink, outgoingLink }) });
    }

    it('recomputes the open Backlinks and Outgoing Links views after a projection', async () => {
      const { app, component } = setup({ entries: [{ isFolderFlag: false, path: 'a.md' }], isIgnored: () => false });
      const backlink = { backlinkFile: 'stale', unlinkedFile: 'stale', update: vi.fn() };
      const outgoingLink = { outgoingFile: 'stale', unlinkedFile: 'stale', update: vi.fn() };
      vi.mocked(app.workspace.getLeavesOfType).mockImplementation((viewType) => {
        if (viewType === 'backlink') {
          return [linkLeaf(backlink, undefined)];
        }
        if (viewType === 'outgoing-link') {
          return [linkLeaf(undefined, outgoingLink)];
        }
        return [];
      });

      await component.update();

      expect(backlink.update).toHaveBeenCalledTimes(1);
      expect(backlink.backlinkFile).toBeNull();
      expect(backlink.unlinkedFile).toBeNull();
      expect(outgoingLink.update).toHaveBeenCalledTimes(1);
      expect(outgoingLink.outgoingFile).toBeNull();
    });

    it('ignores a link view that exposes no renderer', async () => {
      const { app, component } = setup({ entries: [{ isFolderFlag: false, path: 'a.md' }], isIgnored: () => false });
      vi.mocked(app.workspace.getLeavesOfType).mockReturnValue([linkLeaf(undefined, undefined)]);

      await expect(component.update()).resolves.toBeUndefined();
    });

    it('does not touch link views in FilesPane mode', async () => {
      const { app, component } = setup({
        entries: [{ isFolderFlag: false, path: 'a.md' }],
        excludeMode: ExcludeMode.FilesPane,
        isIgnored: () => false
      });

      await component.update();

      expect(app.workspace.getLeavesOfType).not.toHaveBeenCalled();
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
      // Layout-ready projection. The projection yields a (faked) paint frame, so advance
      // Timers to let load finish.
      const loadPromise = component.loadWithPromises();
      await vi.runAllTimersAsync();
      await loadPromise;
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

      // The projection yields a (faked) paint frame, so advance timers to let load finish.
      const loadPromise = component.loadWithPromises();
      await vi.runAllTimersAsync();
      await loadPromise;
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
      // The projection yields a (faked) paint frame, so advance timers to let load finish.
      const loadPromise = component.loadWithPromises();
      await vi.runAllTimersAsync();
      await loadPromise;

      expect(() => {
        component.unload();
      }).not.toThrow();
    });

    it('aborts an in-flight update', async () => {
      const { component, manualIndexHider } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md'
      });

      // The load-time projection is in flight (parked on the initial paint yield / async
      // Model rebuild); unload aborts it before it hides.
      const loadPromise = component.loadWithPromises();
      component.unload();
      await vi.runAllTimersAsync();
      await loadPromise;

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

  describe('fast enable', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // The universe signature the component computes on enable, over `loaded ∪ hidden`.
    function matchingSignature(loaded: readonly MockEntry[], hidden: readonly MockEntry[]): string {
      return computeUniverseSignature([...loaded.map((entry) => entry.path), ...hidden.map((entry) => entry.path)]);
    }

    async function runLoad(component: IndexProjectionComponent): Promise<void> {
      const loadPromise = component.loadWithPromises();
      await vi.runAllTimersAsync();
      await loadPromise;
    }

    it('re-hides the persisted set directly without a full recompute', async () => {
      const loaded: MockEntry[] = [
        { isFolderFlag: false, path: 'a.md' },
        { isFolderFlag: false, path: 'junk.tmp' }
      ];
      const hidden: MockEntry[] = [{ isFolderFlag: false, path: 'junk.tmp' }];
      const { component, deleteFromFilesPane, manualIndexHider, save } = setup({
        configUnchanged: true,
        entries: loaded,
        // Never consulted on the fast path (no recompute).
        isIgnored: () => false,
        persistedEntries: hidden,
        persistedUniverseSignature: matchingSignature(loaded, hidden)
      });

      await runLoad(component);

      expect(manualIndexHider.hide).toHaveBeenCalledExactlyOnceWith(['junk.tmp']);
      expect(deleteFromFilesPane).toHaveBeenCalledWith('junk.tmp');
      // The fast path seeds only the hidden set, so the model never holds the whole vault…
      const model = castTo<TestableIndexProjectionComponent>(component).vaultModel;
      expect(model.getPathsByVisibility(false)).toEqual([{ isFolder: false, path: 'junk.tmp' }]);
      expect(model.isVisible('a.md')).toBeUndefined();
      // …and it does not persist (nothing was recomputed).
      expect(save).not.toHaveBeenCalled();
    });

    it('does not re-project on layout ready after a fast enable', async () => {
      const loaded: MockEntry[] = [
        { isFolderFlag: false, path: 'a.md' },
        { isFolderFlag: false, path: 'junk.tmp' }
      ];
      const hidden: MockEntry[] = [{ isFolderFlag: false, path: 'junk.tmp' }];
      const { component, fireWorkspaceLayoutReady, manualIndexHider } = setup({
        configUnchanged: true,
        entries: loaded,
        isIgnored: () => false,
        persistedEntries: hidden,
        persistedUniverseSignature: matchingSignature(loaded, hidden),
        vaultLoadCalled: false
      });

      await runLoad(component);
      manualIndexHider.hide.mockClear();

      fireWorkspaceLayoutReady();
      await vi.runAllTimersAsync();

      expect(manualIndexHider.hide).not.toHaveBeenCalled();
    });

    it('restores the fast-hidden set from snapshots on disable', async () => {
      const loaded: MockEntry[] = [
        { isFolderFlag: false, path: 'a.md' },
        { isFolderFlag: false, path: 'junk.tmp' }
      ];
      const hidden: MockEntry[] = [{ isFolderFlag: false, path: 'junk.tmp' }];
      const { addToFilesPane, component, manualIndexHider } = setup({
        configUnchanged: true,
        entries: loaded,
        isIgnored: () => false,
        persistedEntries: hidden,
        persistedUniverseSignature: matchingSignature(loaded, hidden)
      });

      await runLoad(component);

      expect(component.restoreHiddenFilesOnUnload()).toBe(true);
      expect(manualIndexHider.show).toHaveBeenCalledWith(['junk.tmp']);
      expect(addToFilesPane).toHaveBeenCalledWith('junk.tmp');
    });

    it('falls back to a full projection when the universe signature does not match', async () => {
      const loaded: MockEntry[] = [
        { isFolderFlag: false, path: 'a.md' },
        { isFolderFlag: false, path: 'junk.tmp' }
      ];
      const { component, manualIndexHider, save } = setup({
        configUnchanged: true,
        entries: loaded,
        isIgnored: (path) => path === 'junk.tmp',
        persistedEntries: [{ isFolderFlag: false, path: 'junk.tmp' }],
        persistedUniverseSignature: 'stale:signature'
      });

      await runLoad(component);

      // The proven full path ran: it recomputed and persisted.
      expect(save).toHaveBeenCalled();
      expect(manualIndexHider.hide).toHaveBeenCalledWith(['junk.tmp']);
    });

    it('falls back to a full projection when the config fingerprint changed', async () => {
      const loaded: MockEntry[] = [{ isFolderFlag: false, path: 'junk.tmp' }];
      const hidden: MockEntry[] = [{ isFolderFlag: false, path: 'junk.tmp' }];
      const { component, save } = setup({
        configUnchanged: false,
        entries: loaded,
        isIgnored: (path) => path === 'junk.tmp',
        persistedEntries: hidden,
        persistedUniverseSignature: matchingSignature(loaded, hidden)
      });

      await runLoad(component);

      expect(save).toHaveBeenCalled();
    });

    it('falls back to a full projection for a legacy record with no signature', async () => {
      const { component, save } = setup({
        configUnchanged: true,
        entries: [{ isFolderFlag: false, path: 'junk.tmp' }],
        isIgnored: (path) => path === 'junk.tmp',
        persistedEntries: [{ isFolderFlag: false, path: 'junk.tmp' }],
        persistedUniverseSignature: null
      });

      await runLoad(component);

      expect(save).toHaveBeenCalled();
    });

    it('does not fast-enable in FilesPane mode', async () => {
      const loaded: MockEntry[] = [{ isFolderFlag: false, path: 'junk.tmp' }];
      const hidden: MockEntry[] = [{ isFolderFlag: false, path: 'junk.tmp' }];
      const { component, manualIndexHider, save } = setup({
        configUnchanged: true,
        entries: loaded,
        excludeMode: ExcludeMode.FilesPane,
        isIgnored: (path) => path === 'junk.tmp',
        persistedEntries: hidden,
        persistedUniverseSignature: matchingSignature(loaded, hidden)
      });

      await runLoad(component);

      // The full path ran (persisted); FilesPane never mutates the index.
      expect(save).toHaveBeenCalled();
      expect(manualIndexHider.hide).not.toHaveBeenCalled();
    });

    it('falls back to a full projection when there is no persisted hidden set', async () => {
      const { component, save } = setup({
        configUnchanged: true,
        entries: [{ isFolderFlag: false, path: 'a.md' }],
        isIgnored: () => false,
        persistedEntries: [],
        persistedUniverseSignature: matchingSignature([{ isFolderFlag: false, path: 'a.md' }], [])
      });

      await runLoad(component);

      // Nothing to fast-hide, so the normal path runs and persists.
      expect(save).toHaveBeenCalled();
    });
  });

  describe('restoreHiddenFilesOnUnload', () => {
    it('restores the hidden set from snapshots and drives the explorer shallowest-first (Full mode)', async () => {
      const { addToFilesPane, component, manualIndexHider } = setup({
        entries: [
          { isFolderFlag: true, path: 'a' },
          { isFolderFlag: false, path: 'a/x.md' }
        ],
        isIgnored: (path) => path === 'a' || path.startsWith('a/')
      });
      await component.applyFull();
      addToFilesPane.mockClear();

      const restored = component.restoreHiddenFilesOnUnload();

      expect(restored).toBe(true);
      expect(manualIndexHider.show).toHaveBeenCalledWith(expect.arrayContaining(['a', 'a/x.md']));
      // Shallowest-first: the folder is re-inserted before the file it contains.
      expect(addToFilesPane.mock.calls.map((call) => call[0])).toEqual(['a', 'a/x.md']);
    });

    it('reports an incomplete restore when a hidden path has no snapshot', async () => {
      const { addToFilesPane, component, manualIndexHider } = setup({
        entries: [
          { isFolderFlag: true, path: 'a' },
          { isFolderFlag: false, path: 'a/x.md' }
        ],
        isIgnored: (path) => path === 'a' || path.startsWith('a/')
      });
      await component.applyFull();
      addToFilesPane.mockClear();
      // A path with no snapshot (e.g. a prior-session hide never loaded) cannot be
      // Restored synchronously, so the tree is not fully back and the notice must show.
      manualIndexHider.show.mockReturnValue(['a/x.md']);

      const restored = component.restoreHiddenFilesOnUnload();

      expect(restored).toBe(false);
      // Only the snapshot-backed path is re-added to the explorer.
      expect(addToFilesPane.mock.calls.map((call) => call[0])).toEqual(['a']);
    });

    it('does nothing and reports restored in FilesPane mode (the index was never mutated)', async () => {
      const { addToFilesPane, component, manualIndexHider } = setup({
        entries: [
          { isFolderFlag: true, path: 'a' },
          { isFolderFlag: false, path: 'a/x.md' }
        ],
        excludeMode: ExcludeMode.FilesPane,
        isIgnored: (path) => path === 'a' || path.startsWith('a/')
      });
      await component.applyFull();
      addToFilesPane.mockClear();

      const restored = component.restoreHiddenFilesOnUnload();

      expect(restored).toBe(true);
      expect(manualIndexHider.show).not.toHaveBeenCalled();
      expect(addToFilesPane).not.toHaveBeenCalled();
    });

    it('is idempotent — a second call restores nothing', async () => {
      const { component, manualIndexHider } = setup({
        entries: [{ isFolderFlag: false, path: 'drop.md' }],
        isIgnored: (path) => path === 'drop.md'
      });
      await component.applyFull();

      expect(component.restoreHiddenFilesOnUnload()).toBe(true);
      expect(component.restoreHiddenFilesOnUnload()).toBe(true);
      expect(manualIndexHider.show).toHaveBeenCalledTimes(1);
    });

    describe('app shutdown', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('skips the restore during app quit (index/explorer are being torn down)', async () => {
        const { component, fireQuit, manualIndexHider } = setup({
          entries: [{ isFolderFlag: false, path: 'drop.md' }],
          isIgnored: (path) => path === 'drop.md'
        });

        // Load so onloadAsync registers the `'quit'` handler; advance the (faked) paint
        // Frame so the load-time projection finishes and hides the file.
        const loadPromise = component.loadWithPromises();
        await vi.runAllTimersAsync();
        await loadPromise;
        manualIndexHider.show.mockClear();

        fireQuit();
        const restored = component.restoreHiddenFilesOnUnload();

        expect(restored).toBe(true);
        expect(manualIndexHider.show).not.toHaveBeenCalled();
      });
    });
  });

  describe('recordCreate / recordDelete', () => {
    it('records a created path into the model and removes it on delete', () => {
      const { component } = setup({
        entries: [{ isFolderFlag: false, path: 'a.md' }],
        isIgnored: () => false
      });

      component.recordCreate({ isFolderPath: false, normalizedPath: 'new/file.md' });
      expect(castTo<TestableIndexProjectionComponent>(component).vaultModel.isVisible('new/file.md')).not.toBeUndefined();

      component.recordDelete('new/file.md');
      expect(castTo<TestableIndexProjectionComponent>(component).vaultModel.isVisible('new/file.md')).toBeUndefined();
    });
  });
});
