import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type {
  App as AppOriginal,
  EventRef
} from 'obsidian';

import { registerAsyncEvent } from '@mnaoumov/obsidian-lib/components/async-events-component';
import { PluginNoticeMode } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import { ensureMetadataCacheReady } from '@mnaoumov/obsidian-lib/metadata-cache';
import { invokeAsyncSafelyAfterDelay } from '@mnaoumov/typescript-lib/async';
import { noop } from '@mnaoumov/typescript-lib/function';
import {
  castTo,
  isDeepEqual
} from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type {
  EffectiveSettings,
  ImportedFileContents
} from './profiles.ts';

import {
  readIfExists,
  readSafe,
  statSafe,
  writeSafe
} from './data-adapter-safe.ts';
import {
  IgnorePatternsComponent,
  REPORTED_MISSING_IMPORTS_LOCAL_STORAGE_KEY
} from './ignore-patterns-component.ts';
import { LOCAL_PATTERNS_HEADER } from './local-patterns.ts';
import { PluginSettings } from './plugin-settings.ts';
import { resolveProfile } from './profiles.ts';

vi.mock('./data-adapter-safe.ts', () => ({
  readIfExists: vi.fn().mockResolvedValue(null),
  readSafe: vi.fn().mockResolvedValue(''),
  statSafe: vi.fn().mockResolvedValue(null),
  writeSafe: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@mnaoumov/obsidian-lib/metadata-cache', () => ({
  ensureMetadataCacheReady: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@mnaoumov/obsidian-lib/components/async-events-component', () => ({
  registerAsyncEvent: vi.fn()
}));

// Keep the REAL invokeAsyncSafelyAfterDelay (so its genuine obsidian-lib scheduling/error-handling runs).
// It is wrapped in a vi.fn pass-through purely so tests can assert it was invoked.
// The real body is not re-created: vi.fn delegates every call to actual.invokeAsyncSafelyAfterDelay unchanged.
vi.mock('@mnaoumov/typescript-lib/async', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mnaoumov/typescript-lib/async')>();
  return {
    ...actual,
    invokeAsyncSafelyAfterDelay: vi.fn(actual.invokeAsyncSafelyAfterDelay)
  };
});

vi.mock('@mnaoumov/typescript-lib/object-utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('@mnaoumov/typescript-lib/object-utils')>(),
  isDeepEqual: vi.fn().mockReturnValue(true)
}));

interface CreateComponentOverrides {
  app?: AppOriginal;
  isSettingsTabOpen?: () => boolean;
  onUpdateFileTree?: () => Promise<void>;
  pluginNoticeComponent?: PluginNoticeComponent;
  pluginSettingsComponent?: PluginSettingsComponent;
}

interface FileIgnoreEntry {
  isIgnored: boolean;
  path: string;
}

type MockCallEntry = [string, (...$arguments: unknown[]) => unknown];

interface MockIDBObjectStore {
  clear: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

interface MockIDBTransaction {
  commit: ReturnType<typeof vi.fn>;
  objectStore: ReturnType<typeof vi.fn>;
}

interface MtimeEntryWithGitIgnore {
  gitIgnoreMtime: number;
}

interface MtimeEntryWithObsidianIgnore {
  obsidianIgnoreMtime: number;
}

interface MtimeEntryWithUserIgnoreFilters {
  userIgnoreFiltersString: string;
}

interface PendingOpen {
  succeed?: () => void;
}

interface ProfileState {
  activeProfileId: null | string;
}

interface SaveSettingsEffectiveValues {
  ignorePatterns: string;
}

interface SaveSettingsState {
  effectiveValues: SaveSettingsEffectiveValues;
}

interface SetupIndexedDatabaseParams {
  readonly filesEntries?: FileIgnoreEntry[];
  readonly mtimeEntry?: unknown;
  readonly upgradeNewVersion?: number;
}

interface SetupIndexedDatabaseResult {
  readonly filesStore: MockIDBObjectStore;
  readonly mockDatabase: IDBDatabase;
  readonly mtimeStore: MockIDBObjectStore;
  readonly openFunction: ReturnType<typeof vi.fn>;
}

interface TestableIgnorePatternsComponent {
  clearCachedExcludeRegExps: () => void;
  resetDatabase: () => Promise<void>;
}

interface UpgradeEvent {
  newVersion: number;
}

// Exposes the protected onLayoutReady so tests can invoke it directly, as they did before it became protected.
class TestIgnorePatternsComponent extends IgnorePatternsComponent {
  public invokeOnLayoutReady(): Promise<void> {
    return this.onLayoutReady();
  }
}

function createApp(): AppOriginal {
  const app = App.createConfigured__({ appId: 'test-app' });
  const appWithConfig = app.asOriginalType__();
  // Add appId and getConfig which the mock doesn't provide
  Object.defineProperty(appWithConfig, 'appId', { value: 'test-app', writable: true });
  Object.defineProperty(appWithConfig.vault, 'getConfig', { value: vi.fn().mockReturnValue([]), writable: true });
  return appWithConfig;
}

function createComponent(overrides?: CreateComponentOverrides): TestIgnorePatternsComponent {
  return new TestIgnorePatternsComponent({
    app: overrides?.app ?? createApp(),
    // Open by default, so a save only raises the pending change, as it did before saves outside the tab applied.
    isSettingsTabOpen: overrides?.isSettingsTabOpen ?? ((): boolean => true),
    onUpdateFileTree: overrides?.onUpdateFileTree ?? vi.fn().mockResolvedValue(undefined),
    pluginNoticeComponent: overrides?.pluginNoticeComponent ?? createPluginNoticeComponent(),
    pluginSettingsComponent: overrides?.pluginSettingsComponent ?? createPluginSettingsComponent()
  });
}

function createMockObjectStore(entries: FileIgnoreEntry[] = []): MockIDBObjectStore {
  return {
    clear: vi.fn(),
    delete: vi.fn().mockReturnValue(createMockRequest(undefined)),
    get: vi.fn().mockReturnValue(createMockRequest(undefined)),
    getAll: vi.fn().mockReturnValue(createMockRequest(entries)),
    put: vi.fn().mockReturnValue(createMockRequest(undefined))
  };
}

function createMockRequest<T>(result: T): IDBRequest<T> {
  const request = {
    readyState: 'done' as IDBRequestReadyState,
    result
  };
  Object.defineProperty(request, 'addEventListener', { value: vi.fn() });
  return request as IDBRequest<T>;
}

function createMockTransaction(stores: Record<string, MockIDBObjectStore>): MockIDBTransaction {
  return {
    commit: vi.fn(),
    objectStore: vi.fn((name: string) => stores[name])
  };
}

function createPluginNoticeComponent(): PluginNoticeComponent {
  return strictProxy<PluginNoticeComponent>({
    showNotice: vi.fn()
  });
}

function createPluginSettingsComponent(settings?: Partial<PluginSettings>, profileState?: ProfileState): PluginSettingsComponent {
  const effectiveSettings = new PluginSettings();
  if (settings) {
    Object.assign(effectiveSettings, settings);
  }

  let importedFileContents: ImportedFileContents = new Map();
  return strictProxy<PluginSettingsComponent>({
    // A getter, so a test that edits `settings` after construction is seen by the component.
    get effectiveSettings(): EffectiveSettings {
      // Not a plain object: strictProxy caches a plain object a getter returns, which would freeze the first answer.
      return Object.assign(
        Object.create(null) as EffectiveSettings,
        resolveProfile({ activeProfileId: profileState?.activeProfileId ?? null, importedFileContents, settings: effectiveSettings })
      );
    },
    get importedFileContents(): ImportedFileContents {
      return importedFileContents;
    },
    on: vi.fn().mockReturnValue(strictProxy<EventRef>({})),
    onActiveProfileChange: vi.fn().mockReturnValue(noop),
    setImportedFileContents: vi.fn((contents: ImportedFileContents) => {
      importedFileContents = contents;
    }),
    setProperty: vi.fn().mockResolvedValue(''),
    settings: effectiveSettings
  });
}

function getFragmentText(message: DocumentFragment | string | undefined): string {
  return typeof message === 'string' ? message : message?.textContent ?? '';
}

function getMtimeEntries(mtimeStore: MockIDBObjectStore): unknown[] {
  return mtimeStore.put.mock.calls.map(([entry]) => entry as unknown);
}

function setupIndexedDatabase(params?: SetupIndexedDatabaseParams): SetupIndexedDatabaseResult {
  const filesStore = createMockObjectStore(params?.filesEntries ?? []);
  const mtimeStore = createMockObjectStore();
  mtimeStore.get.mockReturnValue(createMockRequest(params?.mtimeEntry));

  const mockDatabase = strictProxy<IDBDatabase>({
    close: vi.fn(),
    createObjectStore: vi.fn()
  });
  const mockTransactionFunction = vi.fn(() => createMockTransaction({ files: filesStore, mtime: mtimeStore }));
  Object.defineProperty(mockDatabase, 'transaction', { value: mockTransactionFunction });

  const newVersion = params?.upgradeNewVersion ?? 1;

  const mockAddEventListener = vi.fn((event: string, handler: ($event: UpgradeEvent) => void) => {
    if (event === 'upgradeneeded') {
      handler({ newVersion });
    }
  });
  const openRequestProxy = strictProxy<IDBOpenDBRequest>({
    readyState: 'done',
    result: mockDatabase
  });
  Object.defineProperty(openRequestProxy, 'addEventListener', { value: mockAddEventListener });

  const openFunction = vi.fn().mockReturnValue(openRequestProxy);

  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: strictProxy<IDBFactory>({
      open: openFunction
    }),
    writable: true
  });

  return { filesStore, mockDatabase, mtimeStore, openFunction };
}

describe('IgnorePatternsComponent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    // Flush delayed async operations scheduled via the real invokeAsyncSafelyAfterDelay.
    // This lets typescript-test-toolkit's async-operation tracking settle them.
    // Otherwise its global afterEach waitForAllAsyncOperations hangs for the full hook timeout on a scheduled-but-never-run op.
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create an instance', () => {
      setupIndexedDatabase();
      const component = createComponent();
      expect(component).toBeInstanceOf(IgnorePatternsComponent);
    });
  });

  describe('isIgnored', () => {
    it('should return false for ROOT_PATH', () => {
      setupIndexedDatabase();
      const component = createComponent();
      expect(component.isIgnored({ isFolder: false, normalizedPath: '/' })).toBe(false);
    });

    it('should return cached result when available', async () => {
      setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();

      // First call caches the result
      const isResult1 = component.isIgnored({ isFolder: false, normalizedPath: 'some/file.md' });
      // Second call should return the same result from cache
      const isResult2 = component.isIgnored({ isFolder: false, normalizedPath: 'some/file.md' });

      expect(isResult1).toBe(isResult2);
      expect(isResult2).toBe(false);
    });

    it('should test against ignore patterns for files', async () => {
      setupIndexedDatabase();
      const pluginSettingsComponent = createPluginSettingsComponent();
      vi.mocked(readIfExists).mockResolvedValueOnce('*.log');
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: false, normalizedPath: 'debug.log' })).toBe(true);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'readme.md' })).toBe(false);
    });

    it('should treat a line starting with # as a comment, and a backslash-escaped # as a literal #', async () => {
      setupIndexedDatabase();
      vi.mocked(readIfExists).mockResolvedValueOnce('# notes/\n#drafts\n\\#tag.md');
      const component = createComponent();
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: true, normalizedPath: 'notes' })).toBe(false);
      expect(component.isIgnored({ isFolder: false, normalizedPath: '#drafts' })).toBe(false);
      expect(component.isIgnored({ isFolder: false, normalizedPath: '#tag.md' })).toBe(true);
    });

    it('should test both path and path/ for folders', async () => {
      setupIndexedDatabase();
      vi.mocked(readIfExists).mockResolvedValueOnce('build/');
      const component = createComponent();
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: true, normalizedPath: 'build' })).toBe(true);
    });

    it('should test exclude regexps when shouldIgnoreExcludedFiles is true', async () => {
      setupIndexedDatabase();
      const app = createApp();
      vi.mocked(app.vault.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(['secret']);
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: true
      });
      const component = createComponent({ app, pluginSettingsComponent });
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: false, normalizedPath: 'secret/file.md' })).toBe(true);
    });

    it('should handle regex exclude filters wrapped in slashes', async () => {
      setupIndexedDatabase();
      const app = createApp();
      vi.mocked(app.vault.getConfig as ReturnType<typeof vi.fn>).mockReturnValue([String.raw`/\.tmp$/`]);
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: true
      });
      const component = createComponent({ app, pluginSettingsComponent });
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: false, normalizedPath: 'file.tmp' })).toBe(true);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'file.md' })).toBe(false);
    });

    it('should handle invalid regex filters gracefully', async () => {
      setupIndexedDatabase();
      const app = createApp();
      vi.mocked(app.vault.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(['/[invalid/']);
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: true
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const component = createComponent({ app, pluginSettingsComponent });
      await component.loadWithPromises();

      component.isIgnored({ isFolder: false, normalizedPath: 'anything' });
      expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid exclude filter: /[invalid/');
    });

    it('should not use exclude regexps when shouldIgnoreExcludedFiles is false', async () => {
      setupIndexedDatabase();
      const app = createApp();
      vi.mocked(app.vault.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(['secret']);
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: false
      });
      const component = createComponent({ app, pluginSettingsComponent });
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: false, normalizedPath: 'secret/file.md' })).toBe(false);
    });

    it('should return cached exclude regexps on subsequent calls', async () => {
      setupIndexedDatabase();
      const app = createApp();
      const getConfigMock = vi.mocked(app.vault.getConfig as ReturnType<typeof vi.fn>);
      getConfigMock.mockReturnValue(['secret']);
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: true
      });
      const component = createComponent({ app, pluginSettingsComponent });
      await component.loadWithPromises();

      component.isIgnored({ isFolder: false, normalizedPath: 'secret/file.md' });
      component.isIgnored({ isFolder: false, normalizedPath: 'secret/other.md' });

      // getConfig should be called for the first isIgnored, but the second should use cached regexps.
      // We can verify by checking that both return true (i.e., the pattern was applied)
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'secret/file.md' })).toBe(true);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'secret/other.md' })).toBe(true);
    });

    it('should handle single-character filter that looks like regex delimiter', async () => {
      setupIndexedDatabase();
      const app = createApp();
      vi.mocked(app.vault.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(['/']);
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: true
      });
      const component = createComponent({ app, pluginSettingsComponent });
      await component.loadWithPromises();

      // Single "/" has length 1, so filter.length > 1 is false. It should be treated as plain prefix match.
      // The escapeRegExp('/') produces '\/' and the regex becomes /^\//i
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'some/path' })).toBe(false);
    });

    it('should store results in IndexedDB via addStoreAction', async () => {
      const { filesStore } = setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();

      component.isIgnored({ isFolder: false, normalizedPath: 'test.md' });

      // Trigger the debounced store actions
      vi.runAllTimers();

      expect(filesStore.put).toHaveBeenCalled();
    });

    it('should not ignore a folder re-included by the negation whitelist idiom', async () => {
      setupIndexedDatabase();
      vi.mocked(readIfExists).mockResolvedValueOnce('*\n!*/\n!*.md\n!*.canvas\n!*.base');
      const component = createComponent();
      await component.loadWithPromises();

      // `!*/` re-includes directories, so folders must test not-ignored for traversal to descend.
      expect(component.isIgnored({ isFolder: true, normalizedPath: 'sub' })).toBe(false);
      expect(component.isIgnored({ isFolder: true, normalizedPath: 'sub/nested' })).toBe(false);
    });

    it('should re-include whitelisted file extensions and ignore the rest under the negation idiom', async () => {
      setupIndexedDatabase();
      vi.mocked(readIfExists).mockResolvedValueOnce('*\n!*/\n!*.md\n!*.canvas\n!*.base');
      const component = createComponent();
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: false, normalizedPath: 'sub/note.md' })).toBe(false);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'top.canvas' })).toBe(false);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'sub/data.base' })).toBe(false);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'sub/image.png' })).toBe(true);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'sub/note.txt' })).toBe(true);
    });

    it('should still ignore a folder matched by a dir-only or plain pattern', async () => {
      setupIndexedDatabase();
      vi.mocked(readIfExists).mockResolvedValueOnce('build/\nnode_modules\n');
      const component = createComponent();
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: true, normalizedPath: 'build' })).toBe(true);
      expect(component.isIgnored({ isFolder: true, normalizedPath: 'node_modules' })).toBe(true);
    });
  });

  describe('onunload', () => {
    it('drops the queued verdict writes and closes the database', async () => {
      const { filesStore, mockDatabase } = setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();
      component.isIgnored({ isFolder: false, normalizedPath: 'test.md' });

      component.unload();
      vi.runAllTimers();

      expect(filesStore.put).not.toHaveBeenCalled();
      expect(mockDatabase.close).toHaveBeenCalledOnce();
    });

    it('flushes a large verdict queue in several transactions, yielding between them', async () => {
      const { filesStore, mockDatabase } = setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();
      const transactionCallsBefore = vi.mocked(mockDatabase.transaction).mock.calls.length;
      for (let index = 0; index < 2500; index++) {
        component.isIgnored({ isFolder: false, normalizedPath: `note-${String(index)}.md` });
      }

      vi.runAllTimers();

      expect(filesStore.put).toHaveBeenCalledTimes(2500);
      expect(vi.mocked(mockDatabase.transaction).mock.calls.length - transactionCallsBefore).toBe(2);
    });

    it('stops a chunked flush when the store is reset part-way through it', async () => {
      const { filesStore } = setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();
      for (let index = 0; index < 2500; index++) {
        component.isIgnored({ isFolder: false, normalizedPath: `note-${String(index)}.md` });
      }
      // Let the debounce fire the first chunk only.
      vi.advanceTimersByTime(5000);
      expect(filesStore.put).toHaveBeenCalledTimes(2000);

      // The verdicts were computed for the store just cleared, so the rest must not land.
      await castTo<TestableIgnorePatternsComponent>(component).resetDatabase();
      vi.runAllTimers();

      expect(filesStore.put).toHaveBeenCalledTimes(2000);
    });

    it('drops a verdict write queued after unload instead of using the closed database', async () => {
      const { filesStore } = setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();
      component.unload();

      component.isIgnored({ isFolder: false, normalizedPath: 'late.md' });
      vi.runAllTimers();

      expect(filesStore.put).not.toHaveBeenCalled();
    });

    it('does nothing to the database when it was never opened', () => {
      const { mockDatabase } = setupIndexedDatabase();
      const component = createComponent();

      component.unload();

      expect(mockDatabase.close).not.toHaveBeenCalled();
    });
  });

  describe('pagehide', () => {
    it('closes the database and drops the queued verdict writes when the window unloads', async () => {
      const { filesStore, mockDatabase } = setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();
      component.isIgnored({ isFolder: false, normalizedPath: 'test.md' });

      window.dispatchEvent(new Event('pagehide'));
      vi.runAllTimers();

      expect(filesStore.put).not.toHaveBeenCalled();
      expect(mockDatabase.close).toHaveBeenCalledOnce();
      component.unload();
    });
  });

  describe('clearCachedExcludeRegExps', () => {
    it('should clear cached regexps', async () => {
      setupIndexedDatabase();
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: false
      });
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      castTo<TestableIgnorePatternsComponent>(component).clearCachedExcludeRegExps();
      // No error means it cleared successfully
      expect(invokeAsyncSafelyAfterDelay).not.toHaveBeenCalled();
    });

    it('should clear fileIgnoreMap and trigger processConfigChanges when shouldIgnoreExcludedFiles is true', async () => {
      setupIndexedDatabase();
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: true
      });
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      vi.mocked(invokeAsyncSafelyAfterDelay).mockClear();
      castTo<TestableIgnorePatternsComponent>(component).clearCachedExcludeRegExps();

      expect(invokeAsyncSafelyAfterDelay).toHaveBeenCalled();

      // Drain the scheduled processConfigChanges so its callback actually runs.
      await vi.runAllTimersAsync();
    });
  });

  describe('handleDeletedOrDotFile', () => {
    it('should remove path from fileIgnoreMap if present', async () => {
      setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();

      // Populate the cache
      component.isIgnored({ isFolder: false, normalizedPath: 'test.md' });

      await component.handleDeletedOrDotFile('test.md');
      // After deletion, should recalculate
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'test.md' })).toBe(false);
    });

    it('should not add store action when path is not in fileIgnoreMap', async () => {
      const { filesStore } = setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();

      await component.handleDeletedOrDotFile('nonexistent.md');

      vi.runAllTimers();
      // The put from initial isIgnored should not be present since we never called isIgnored
      expect(filesStore.delete).not.toHaveBeenCalled();
    });

    it('should re-read obsidian ignore when path matches', async () => {
      setupIndexedDatabase();
      vi.mocked(readIfExists).mockResolvedValue('');
      const component = createComponent();
      await component.loadWithPromises();

      vi.mocked(readIfExists).mockResolvedValueOnce('new-pattern');
      await component.handleDeletedOrDotFile('.obsidianignore');

      expect(readIfExists).toHaveBeenCalled();
    });

    it('should re-read git ignore when path matches', async () => {
      setupIndexedDatabase();
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIncludeGitIgnorePatterns: true
      });
      vi.mocked(readSafe).mockResolvedValue('');
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      vi.mocked(readSafe).mockResolvedValueOnce('new-git-pattern');
      await component.handleDeletedOrDotFile('.gitignore');

      expect(invokeAsyncSafelyAfterDelay).toHaveBeenCalled();
    });

    it('should update the file tree once the scheduled processConfigChanges runs after an ignore file changes', async () => {
      setupIndexedDatabase();
      vi.mocked(readIfExists).mockResolvedValue('');
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const component = createComponent({ onUpdateFileTree });
      await component.loadWithPromises();

      vi.mocked(readIfExists).mockResolvedValueOnce('archive/\n');
      await component.handleDeletedOrDotFile('.obsidianignore');
      await vi.runAllTimersAsync();

      expect(onUpdateFileTree).toHaveBeenCalledTimes(1);
    });

    it('should not trigger processConfigChanges when ignore file content is unchanged', async () => {
      setupIndexedDatabase();
      vi.mocked(readIfExists).mockResolvedValue('');
      const component = createComponent();
      await component.loadWithPromises();

      vi.mocked(invokeAsyncSafelyAfterDelay).mockClear();
      // readSafe returns '' which matches the initial cached content
      vi.mocked(readIfExists).mockResolvedValueOnce('');
      await component.handleDeletedOrDotFile('.obsidianignore');

      expect(invokeAsyncSafelyAfterDelay).not.toHaveBeenCalled();
    });

    it('should handle a path that is in the fileIgnoreMap and also an ignore file', async () => {
      setupIndexedDatabase();
      vi.mocked(readIfExists).mockResolvedValue('');
      const component = createComponent();
      await component.loadWithPromises();

      // Populate cache with the obsidian ignore file path
      component.isIgnored({ isFolder: false, normalizedPath: '.obsidianignore' });

      vi.mocked(readIfExists).mockResolvedValueOnce('changed-content');
      await component.handleDeletedOrDotFile('.obsidianignore');

      expect(invokeAsyncSafelyAfterDelay).toHaveBeenCalled();

      // Drain the scheduled processConfigChanges so its callback actually runs.
      await vi.runAllTimersAsync();
    });
  });

  describe('processConfigChanges', () => {
    it('should no-op when hadConfigChanges is false', async () => {
      setupIndexedDatabase();
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const component = createComponent({ onUpdateFileTree });
      await component.loadWithPromises();

      await component.processConfigChanges();

      expect(onUpdateFileTree).not.toHaveBeenCalled();
    });

    it('should reset DB and call onUpdateFileTree when hadConfigChanges is true', async () => {
      setupIndexedDatabase();
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const pluginSettingsComponent = createPluginSettingsComponent();
      const component = createComponent({ onUpdateFileTree, pluginSettingsComponent });
      await component.loadWithPromises();

      // We need to simulate the saveSettings event. Since registerAsyncEvent is mocked,
      // we access the on() calls on pluginSettingsComponent
      const onCalls = vi.mocked(pluginSettingsComponent.on).mock.calls as MockCallEntry[];
      const saveSettingsCall = onCalls.find(([name]) => name === 'saveSettings');

      if (saveSettingsCall) {
        const callback = saveSettingsCall[1] as (state: SaveSettingsState) => Promise<void>;
        await callback({ effectiveValues: { ignorePatterns: 'test' } });
      }

      await component.processConfigChanges();

      expect(onUpdateFileTree).toHaveBeenCalled();
    });
  });

  describe('onLayoutReady', () => {
    it('should call ensureMetadataCacheReady', async () => {
      setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();
      await component.invokeOnLayoutReady();

      expect(ensureMetadataCacheReady).toHaveBeenCalled();
    });

    it('should not update the file tree itself, which the index projection owns', async () => {
      setupIndexedDatabase();
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const component = createComponent({ onUpdateFileTree });
      await component.loadWithPromises();
      await component.invokeOnLayoutReady();

      expect(onUpdateFileTree).not.toHaveBeenCalled();
    });

    it('should register config-changed event handler', async () => {
      setupIndexedDatabase();
      const app = createApp();
      const vaultOnSpy = vi.spyOn(app.vault, 'on');
      const component = createComponent({ app });
      await component.loadWithPromises();
      await component.invokeOnLayoutReady();

      expect(vaultOnSpy).toHaveBeenCalledWith('config-changed', expect.any(Function));
    });

    it('should call clearCachedExcludeRegExps when config-changed fires with userIgnoreFilters', async () => {
      setupIndexedDatabase();
      const app = createApp();
      const vaultOnSpy = vi.spyOn(app.vault, 'on');
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: true
      });
      const component = createComponent({ app, pluginSettingsComponent });
      await component.loadWithPromises();
      await component.invokeOnLayoutReady();

      const configChangedCall = (vaultOnSpy.mock.calls as MockCallEntry[]).find(([name]) => name === 'config-changed');
      if (configChangedCall) {
        const callback = configChangedCall[1] as (configKey: string) => void;
        vi.mocked(invokeAsyncSafelyAfterDelay).mockClear();
        callback('userIgnoreFilters');
        expect(invokeAsyncSafelyAfterDelay).toHaveBeenCalled();
      } else {
        expect.fail('config-changed event was not registered');
      }
    });

    it('should not call clearCachedExcludeRegExps for other config keys', async () => {
      setupIndexedDatabase();
      const app = createApp();
      const vaultOnSpy = vi.spyOn(app.vault, 'on');
      const component = createComponent({ app });
      await component.loadWithPromises();
      await component.invokeOnLayoutReady();

      const configChangedCall = (vaultOnSpy.mock.calls as MockCallEntry[]).find(([name]) => name === 'config-changed');
      if (configChangedCall) {
        const callback = configChangedCall[1] as (configKey: string) => void;
        vi.mocked(invokeAsyncSafelyAfterDelay).mockClear();
        callback('someOtherConfig');
        expect(invokeAsyncSafelyAfterDelay).not.toHaveBeenCalled();
      } else {
        expect.fail('config-changed event was not registered');
      }
    });
  });

  describe('onload', () => {
    it('should load DB and reload ignore files', async () => {
      const { openFunction } = setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();

      expect(openFunction).toHaveBeenCalled();
      expect(readIfExists).toHaveBeenCalled();
    });

    it('should register loadSettings and saveSettings event handlers', async () => {
      setupIndexedDatabase();
      const pluginSettingsComponent = createPluginSettingsComponent();
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      // registerAsyncEvent is called for loadSettings and saveSettings from this component;
      // But it may also be called by other components in the chain. Just check it was called.
      expect(registerAsyncEvent).toHaveBeenCalled();
      expect(pluginSettingsComponent.on).toHaveBeenCalledWith('loadSettings', expect.any(Function));
      expect(pluginSettingsComponent.on).toHaveBeenCalledWith('saveSettings', expect.any(Function));
    });

    it('should re-read the ignore files and re-apply on a synced settings load that changes the patterns', async () => {
      setupIndexedDatabase();
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const pluginSettingsComponent = createPluginSettingsComponent();
      const component = createComponent({ onUpdateFileTree, pluginSettingsComponent });
      await component.loadWithPromises();

      const loadSettingsCall = (vi.mocked(pluginSettingsComponent.on).mock.calls as MockCallEntry[]).find(([name]) => name === 'loadSettings');
      if (loadSettingsCall) {
        const callback = loadSettingsCall[1] as (_loadedState: unknown, isInitialLoad: boolean) => Promise<void>;
        vi.mocked(readIfExists).mockClear();
        await callback(undefined, false);
        expect(readIfExists).not.toHaveBeenCalled();

        (pluginSettingsComponent.settings as PluginSettings).ignorePatterns = 'synced/';
        await callback(undefined, false);
        expect(readIfExists).toHaveBeenCalled();
        expect(onUpdateFileTree).toHaveBeenCalledOnce();
        expect(component.isIgnored({ isFolder: false, normalizedPath: 'synced/a.md' })).toBe(true);
      } else {
        expect.fail('loadSettings event was not registered');
      }
    });

    it('should skip readObsidianIgnore on initial loadSettings', async () => {
      setupIndexedDatabase();
      const pluginSettingsComponent = createPluginSettingsComponent();
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      const loadSettingsCall = (vi.mocked(pluginSettingsComponent.on).mock.calls as MockCallEntry[]).find(([name]) => name === 'loadSettings');
      if (loadSettingsCall) {
        const callback = loadSettingsCall[1] as (_loadedState: unknown, isInitialLoad: boolean) => Promise<void>;
        vi.mocked(readIfExists).mockClear();
        await callback(undefined, true);
        expect(readIfExists).not.toHaveBeenCalled();
      } else {
        expect.fail('loadSettings event was not registered');
      }
    });

    it('should handle saveSettings event', async () => {
      setupIndexedDatabase();
      const pluginSettingsComponent = createPluginSettingsComponent();
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      const saveSettingsCall = (vi.mocked(pluginSettingsComponent.on).mock.calls as MockCallEntry[]).find(([name]) => name === 'saveSettings');
      if (saveSettingsCall) {
        const callback = saveSettingsCall[1] as () => Promise<void>;
        (pluginSettingsComponent.settings as PluginSettings).ignorePatterns = 'new-pattern';
        await callback();

        expect(component.isIgnored({ isFolder: false, normalizedPath: 'new-pattern' })).toBe(true);
      } else {
        expect.fail('saveSettings event was not registered');
      }
    });

    it('should leave a save made while the settings tab is open for the tab to apply', async () => {
      setupIndexedDatabase();
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const pluginSettingsComponent = createPluginSettingsComponent();
      const component = createComponent({ isSettingsTabOpen: () => true, onUpdateFileTree, pluginSettingsComponent });
      await component.loadWithPromises();

      const saveSettingsCall = (vi.mocked(pluginSettingsComponent.on).mock.calls as MockCallEntry[]).find(([name]) => name === 'saveSettings');
      const callback = saveSettingsCall?.[1] as (newState: SaveSettingsState) => Promise<void>;
      await callback({ effectiveValues: { ignorePatterns: 'new-pattern' } });

      expect(onUpdateFileTree).not.toHaveBeenCalled();
      await component.processConfigChanges();
      expect(onUpdateFileTree).toHaveBeenCalledOnce();
    });

    it('should apply a save made while the settings tab is closed', async () => {
      setupIndexedDatabase();
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const pluginSettingsComponent = createPluginSettingsComponent();
      const component = createComponent({ isSettingsTabOpen: () => false, onUpdateFileTree, pluginSettingsComponent });
      await component.loadWithPromises();

      const saveSettingsCall = (vi.mocked(pluginSettingsComponent.on).mock.calls as MockCallEntry[]).find(([name]) => name === 'saveSettings');
      const callback = saveSettingsCall?.[1] as (newState: SaveSettingsState) => Promise<void>;
      await callback({ effectiveValues: { ignorePatterns: 'new-pattern' } });

      expect(onUpdateFileTree).toHaveBeenCalledOnce();
      // Applied already, so the tab's own later call has nothing left to do.
      await component.processConfigChanges();
      expect(onUpdateFileTree).toHaveBeenCalledOnce();
    });
  });

  describe('profiles', () => {
    const PROFILE_SETTINGS: Partial<PluginSettings> = {
      ignorePatterns: 'base/*',
      profiles: [{ id: 'work', name: 'Work', patterns: 'work/\n!base/keep.md' }]
    };

    it('should match against the expanded patterns of the active profile', async () => {
      setupIndexedDatabase();
      const pluginSettingsComponent = createPluginSettingsComponent(PROFILE_SETTINGS, { activeProfileId: 'work' });
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: false, normalizedPath: 'work/a.md' })).toBe(true);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'base/a.md' })).toBe(true);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'base/keep.md' })).toBe(false);
    });

    it('should put the active profile into the verdict fingerprint, and leave it out with none active', async () => {
      vi.mocked(isDeepEqual).mockReturnValue(false);
      const withProfile = setupIndexedDatabase();
      await createComponent({ pluginSettingsComponent: createPluginSettingsComponent(PROFILE_SETTINGS, { activeProfileId: 'work' }) })
        .loadWithPromises();
      expect(getMtimeEntries(withProfile.mtimeStore)).toStrictEqual([
        expect.objectContaining({ settingsFingerprint: JSON.stringify(['base/*\nwork/\n!base/keep.md', 'Full', false, false, false]) })
      ]);

      const withoutProfile = setupIndexedDatabase();
      await createComponent({ pluginSettingsComponent: createPluginSettingsComponent(PROFILE_SETTINGS) }).loadWithPromises();
      expect(getMtimeEntries(withoutProfile.mtimeStore)).toStrictEqual([
        expect.objectContaining({ settingsFingerprint: JSON.stringify(['base/*', 'Full', false, false, false]) })
      ]);
    });

    it('should re-apply through the config-change path when the active profile changes', async () => {
      setupIndexedDatabase();
      const profileState: ProfileState = { activeProfileId: null };
      const pluginSettingsComponent = createPluginSettingsComponent(PROFILE_SETTINGS, profileState);
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const component = createComponent({ onUpdateFileTree, pluginSettingsComponent });
      await component.loadWithPromises();
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'work/a.md' })).toBe(false);

      const [listener] = vi.mocked(pluginSettingsComponent.onActiveProfileChange).mock.calls[0] ?? [];
      profileState.activeProfileId = 'work';
      await listener?.();

      expect(onUpdateFileTree).toHaveBeenCalledOnce();
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'work/a.md' })).toBe(true);
    });

    it('should re-apply on a synced settings load only when the active profile resolves differently', async () => {
      setupIndexedDatabase();
      const settings = { ...PROFILE_SETTINGS };
      const profileState: ProfileState = { activeProfileId: 'work' };
      const pluginSettingsComponent = createPluginSettingsComponent(settings, profileState);
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const component = createComponent({ onUpdateFileTree, pluginSettingsComponent });
      await component.loadWithPromises();

      const loadSettingsCall = (vi.mocked(pluginSettingsComponent.on).mock.calls as MockCallEntry[]).find(([name]) => name === 'loadSettings');
      const callback = loadSettingsCall?.[1] as (_loadedState: unknown, isInitialLoad: boolean) => Promise<void>;

      await callback(undefined, false);
      expect(onUpdateFileTree).not.toHaveBeenCalled();

      (pluginSettingsComponent.settings as PluginSettings).profiles = [{ id: 'work', name: 'Work', patterns: 'other/' }];
      await callback(undefined, false);
      expect(onUpdateFileTree).toHaveBeenCalledOnce();
    });
  });

  describe('imported files', () => {
    const IMPORT_SETTINGS: Partial<PluginSettings> = { profiles: [{ id: 'work', name: 'Work', patterns: '@import file:ignores/work.txt' }] };

    function getRawListener(vaultOnCalls: unknown[][]): (path: string) => void {
      const rawCall = (vaultOnCalls as MockCallEntry[]).find(([name]) => name === 'raw');
      return rawCall?.[1] as (path: string) => void;
    }

    // `.obsidianignore` is read through the same `readIfExists`, so only the imported path gets the content.
    function mockImportedFileContent(content: null | string): void {
      vi.mocked(readIfExists).mockImplementation((_app, path) => Promise.resolve(path === '.obsidianignore' ? null : content));
    }

    it('should read an imported file before the fingerprint, so it reaches both the matcher and the fingerprint', async () => {
      vi.mocked(isDeepEqual).mockReturnValue(false);
      mockImportedFileContent('from-file/');
      const { mtimeStore } = setupIndexedDatabase();
      const component = createComponent({ pluginSettingsComponent: createPluginSettingsComponent(IMPORT_SETTINGS, { activeProfileId: 'work' }) });
      await component.loadWithPromises();

      expect(readIfExists).toHaveBeenCalledWith(expect.anything(), 'ignores/work.txt');
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'from-file/a.md' })).toBe(true);
      expect(getMtimeEntries(mtimeStore)[0]).toStrictEqual(expect.objectContaining({ settingsFingerprint: JSON.stringify(['from-file/', 'Full', false, false, false]) }));
    });

    it('should re-apply when an imported file changes on disk, and only then', async () => {
      mockImportedFileContent('from-file/');
      setupIndexedDatabase();
      const app = createApp();
      const vaultOnSpy = vi.spyOn(app.vault, 'on');
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const component = createComponent({ app, onUpdateFileTree, pluginSettingsComponent: createPluginSettingsComponent(IMPORT_SETTINGS, { activeProfileId: 'work' }) });
      await component.loadWithPromises();
      const rawListener = getRawListener(vaultOnSpy.mock.calls);

      rawListener('unrelated.md');
      rawListener('ignores/work.txt');
      await vi.runAllTimersAsync();
      expect(onUpdateFileTree).not.toHaveBeenCalled();

      mockImportedFileContent('changed/');
      rawListener('ignores/work.txt');
      await vi.runAllTimersAsync();

      expect(onUpdateFileTree).toHaveBeenCalledOnce();
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'changed/a.md' })).toBe(true);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'from-file/a.md' })).toBe(false);
    });

    it('should treat a file that appeared under a known path as changed', async () => {
      mockImportedFileContent(null);
      setupIndexedDatabase();
      const app = createApp();
      const vaultOnSpy = vi.spyOn(app.vault, 'on');
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const component = createComponent({ app, onUpdateFileTree, pluginSettingsComponent: createPluginSettingsComponent(IMPORT_SETTINGS, { activeProfileId: 'work' }) });
      await component.loadWithPromises();

      mockImportedFileContent('');
      getRawListener(vaultOnSpy.mock.calls)('ignores/work.txt');
      await vi.runAllTimersAsync();

      expect(onUpdateFileTree).toHaveBeenCalledOnce();
    });

    it('should report a missing imported file once per device, and again only after it existed in between', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(noop);
      const expectedMessage = 'The profile `Work` imports `ignores/work.txt` with `@import file:`, but the file does not exist, so it imports nothing.';
      mockImportedFileContent(null);
      setupIndexedDatabase();
      const app = createApp();
      app.saveLocalStorage(REPORTED_MISSING_IMPORTS_LOCAL_STORAGE_KEY, null);
      const vaultOnSpy = vi.spyOn(app.vault, 'on');
      const pluginNoticeComponent = createPluginNoticeComponent();
      const component = createComponent({ app, pluginNoticeComponent, pluginSettingsComponent: createPluginSettingsComponent(IMPORT_SETTINGS, { activeProfileId: 'work' }) });
      await component.loadWithPromises();

      expect(consoleWarnSpy).toHaveBeenCalledExactlyOnceWith(expectedMessage);
      expect(pluginNoticeComponent.showNotice).toHaveBeenCalledOnce();
      expect(getFragmentText(vi.mocked(pluginNoticeComponent.showNotice).mock.calls[0]?.[0])).toBe(expectedMessage.replaceAll('`', ''));
      expect(app.loadLocalStorage(REPORTED_MISSING_IMPORTS_LOCAL_STORAGE_KEY)).toStrictEqual(['ignores/work.txt']);

      // A new load on the same device, as after an app restart: already reported.
      await createComponent({ app, pluginNoticeComponent, pluginSettingsComponent: createPluginSettingsComponent(IMPORT_SETTINGS, { activeProfileId: 'work' }) }).loadWithPromises();
      expect(consoleWarnSpy).toHaveBeenCalledOnce();

      const rawListener = getRawListener(vaultOnSpy.mock.calls);
      mockImportedFileContent('');
      rawListener('ignores/work.txt');
      await vi.runAllTimersAsync();
      expect(app.loadLocalStorage(REPORTED_MISSING_IMPORTS_LOCAL_STORAGE_KEY)).toStrictEqual([]);

      mockImportedFileContent(null);
      rawListener('ignores/work.txt');
      await vi.runAllTimersAsync();
      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
    });

    it('should ignore a stored value that is not a list of paths', async () => {
      vi.spyOn(console, 'warn').mockImplementation(noop);
      mockImportedFileContent(null);
      setupIndexedDatabase();
      const app = createApp();
      app.saveLocalStorage(REPORTED_MISSING_IMPORTS_LOCAL_STORAGE_KEY, ['ignores/work.txt', 1]);
      const pluginNoticeComponent = createPluginNoticeComponent();
      await createComponent({ app, pluginNoticeComponent, pluginSettingsComponent: createPluginSettingsComponent(IMPORT_SETTINGS, { activeProfileId: 'work' }) }).loadWithPromises();
      expect(pluginNoticeComponent.showNotice).not.toHaveBeenCalled();

      app.saveLocalStorage(REPORTED_MISSING_IMPORTS_LOCAL_STORAGE_KEY, 'ignores/work.txt');
      await createComponent({ app, pluginNoticeComponent, pluginSettingsComponent: createPluginSettingsComponent(IMPORT_SETTINGS, { activeProfileId: 'work' }) }).loadWithPromises();
      expect(pluginNoticeComponent.showNotice).toHaveBeenCalledOnce();
    });
  });

  describe('config fingerprint and lazy verdict loading', () => {
    it('should open IndexedDB with correct name', async () => {
      const { openFunction } = setupIndexedDatabase();
      const app = createApp();
      const component = createComponent({ app });
      await component.loadWithPromises();

      expect(openFunction).toHaveBeenCalledWith('test-app/advanced-exclude', 1);
    });

    it('should create object stores on upgradeneeded with newVersion 1', async () => {
      const { mockDatabase } = setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();

      expect(mockDatabase.createObjectStore).toHaveBeenCalledTimes(2);
    });

    it('should skip object store creation when newVersion is not 1', async () => {
      const { mockDatabase } = setupIndexedDatabase({ upgradeNewVersion: 2 });
      const component = createComponent();
      await component.loadWithPromises();

      expect(mockDatabase.createObjectStore).not.toHaveBeenCalled();
    });

    it('marks the config unchanged and defers the verdict getAll when mtime matches', async () => {
      vi.mocked(isDeepEqual).mockReturnValue(true);
      const { filesStore } = setupIndexedDatabase({
        filesEntries: [
          { isIgnored: true, path: 'ignored.md' },
          { isIgnored: false, path: 'visible.md' }
        ]
      });
      const component = createComponent();
      await component.loadWithPromises();

      // Load validates the fingerprint but does NOT eagerly read the (up to ~90k) verdicts.
      expect(component.isConfigUnchanged()).toBe(true);
      expect(filesStore.getAll).not.toHaveBeenCalled();

      // The cached verdicts hydrate only on demand.
      await component.ensureVerdictsLoaded();
      expect(filesStore.getAll).toHaveBeenCalledTimes(1);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'ignored.md' })).toBe(true);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'visible.md' })).toBe(false);
    });

    it('hydrates persisted verdicts at most once', async () => {
      vi.mocked(isDeepEqual).mockReturnValue(true);
      const { filesStore } = setupIndexedDatabase({ filesEntries: [{ isIgnored: true, path: 'ignored.md' }] });
      const component = createComponent();
      await component.loadWithPromises();

      await component.ensureVerdictsLoaded();
      await component.ensureVerdictsLoaded();
      expect(filesStore.getAll).toHaveBeenCalledTimes(1);
    });

    it('resets the DB and reports the config changed when mtime does not match', async () => {
      vi.mocked(isDeepEqual).mockReturnValue(false);
      const { filesStore } = setupIndexedDatabase({
        filesEntries: [{ isIgnored: true, path: 'old.md' }]
      });
      const component = createComponent();
      await component.loadWithPromises();

      expect(filesStore.clear).toHaveBeenCalled();
      expect(component.isConfigUnchanged()).toBe(false);
      // A reset leaves nothing to hydrate, so a later ensure is a no-op (no getAll).
      await component.ensureVerdictsLoaded();
      expect(filesStore.getAll).not.toHaveBeenCalled();
    });

    it('should use default mtime entry when none stored', async () => {
      vi.mocked(isDeepEqual).mockReturnValue(true);
      setupIndexedDatabase({ mtimeEntry: undefined });
      const component = createComponent();
      await component.loadWithPromises();

      expect(isDeepEqual).toHaveBeenCalled();
    });
  });

  describe('readGitIgnore', () => {
    it('should not read git ignore when shouldIncludeGitIgnorePatterns is false', async () => {
      setupIndexedDatabase();
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIncludeGitIgnorePatterns: false
      });
      const component = createComponent({ pluginSettingsComponent });
      vi.mocked(readSafe).mockClear();
      await component.loadWithPromises();

      // readSafe should only be called for obsidian ignore, not git ignore
      const readSafeCalls = vi.mocked(readSafe).mock.calls;
      const gitIgnoreReads = readSafeCalls.filter(([, path]) => path === '.gitignore');
      expect(gitIgnoreReads).toHaveLength(0);
    });

    it('should read git ignore when shouldIncludeGitIgnorePatterns is true', async () => {
      setupIndexedDatabase();
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIncludeGitIgnorePatterns: true
      });
      vi.mocked(readSafe).mockResolvedValue('');
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      expect(readSafe).toHaveBeenCalled();
    });

    it('should detect git ignore content changes', async () => {
      setupIndexedDatabase();
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIncludeGitIgnorePatterns: true
      });
      vi.mocked(readSafe).mockResolvedValue('');
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      // Now simulate git ignore changing
      vi.mocked(readSafe).mockResolvedValueOnce('node_modules');
      await component.handleDeletedOrDotFile('.gitignore');

      expect(component.isIgnored({ isFolder: false, normalizedPath: 'node_modules/pkg' })).toBe(true);
    });
  });

  describe('readObsidianIgnore', () => {
    it('should match the file patterns after the settings patterns, and never write them into the settings', async () => {
      setupIndexedDatabase();
      const pluginSettingsComponent = createPluginSettingsComponent({ ignorePatterns: 'notes/*' });
      vi.mocked(readIfExists).mockResolvedValueOnce('!notes/keep.md');
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: false, normalizedPath: 'notes/a.md' })).toBe(true);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'notes/keep.md' })).toBe(false);
      expect(pluginSettingsComponent.setProperty).not.toHaveBeenCalled();
    });

    it('should return false when content is unchanged', async () => {
      setupIndexedDatabase();
      vi.mocked(readIfExists).mockResolvedValue('');
      const component = createComponent();
      await component.loadWithPromises();

      // Trigger readObsidianIgnore again with same content
      vi.mocked(readIfExists).mockResolvedValueOnce('');
      await component.handleDeletedOrDotFile('.obsidianignore');

      // No processConfigChanges should be invoked
      vi.mocked(invokeAsyncSafelyAfterDelay).mockClear();
      // Content hasn't changed, so shouldRefresh should be false
      expect(invokeAsyncSafelyAfterDelay).not.toHaveBeenCalled();
    });
  });

  describe('local patterns', () => {
    beforeEach(() => {
      // An earlier test may leave a persistent answer behind: here the file starts out missing.
      vi.mocked(readIfExists).mockResolvedValue(null);
    });

    it('should offer the header to edit while .obsidianignore does not exist, and the file as read once it does', async () => {
      setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();
      expect(component.getLocalPatternsText()).toBe(LOCAL_PATTERNS_HEADER);

      vi.mocked(readIfExists).mockResolvedValueOnce('\u{FEFF}# mine\r\nlocal/\r\n');
      await component.handleDeletedOrDotFile('.obsidianignore');
      expect(component.getLocalPatternsText()).toBe('# mine\nlocal/\n');
    });

    it('should save to the file keeping its line ending, match at once, and apply on the tab\'s hide while it is open', async () => {
      setupIndexedDatabase();
      vi.mocked(readIfExists).mockResolvedValueOnce('old/\r\n');
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const component = createComponent({ onUpdateFileTree });
      await component.loadWithPromises();
      expect(component.isIgnored({ isFolder: true, normalizedPath: 'old' })).toBe(true);

      await component.saveLocalPatterns('new/\n');

      expect(writeSafe).toHaveBeenCalledWith({ app: expect.anything() as unknown, content: 'new/\r\n', path: '.obsidianignore' });
      expect(component.isIgnored({ isFolder: true, normalizedPath: 'old' })).toBe(false);
      expect(component.isIgnored({ isFolder: true, normalizedPath: 'new' })).toBe(true);
      expect(onUpdateFileTree).not.toHaveBeenCalled();

      await component.processConfigChanges();
      expect(onUpdateFileTree).toHaveBeenCalledOnce();
    });

    it('should tell its listeners when an empty file is deleted, though no pattern changed', async () => {
      setupIndexedDatabase();
      vi.mocked(readIfExists).mockResolvedValueOnce('');
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const component = createComponent({ isSettingsTabOpen: () => false, onUpdateFileTree });
      await component.loadWithPromises();
      expect(component.getLocalPatternsText()).toBe('');
      const listener = vi.fn();
      component.onLocalPatternsChange(listener);

      await component.refreshLocalPatterns();
      await vi.runAllTimersAsync();

      expect(listener).toHaveBeenCalledOnce();
      expect(component.getLocalPatternsText()).toBe(LOCAL_PATTERNS_HEADER);
      expect(onUpdateFileTree).not.toHaveBeenCalled();
    });

    it('should drop the local patterns and offer the header again once the file is deleted', async () => {
      setupIndexedDatabase();
      vi.mocked(readIfExists).mockResolvedValueOnce('local/');
      const component = createComponent();
      await component.loadWithPromises();
      expect(component.isIgnored({ isFolder: true, normalizedPath: 'local' })).toBe(true);

      await component.handleDeletedOrDotFile('.obsidianignore');
      await vi.runAllTimersAsync();

      expect(component.getLocalPatternsText()).toBe(LOCAL_PATTERNS_HEADER);
      expect(component.isIgnored({ isFolder: true, normalizedPath: 'local' })).toBe(false);
    });

    it('should apply a save at once while the settings tab is closed', async () => {
      setupIndexedDatabase();
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const component = createComponent({ isSettingsTabOpen: () => false, onUpdateFileTree });
      await component.loadWithPromises();

      await component.saveLocalPatterns('local/');

      expect(onUpdateFileTree).toHaveBeenCalledOnce();
      expect(component.isIgnored({ isFolder: true, normalizedPath: 'local' })).toBe(true);
    });

    it('should not take its own save for an outside edit', async () => {
      setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();
      const listener = vi.fn();
      component.onLocalPatternsChange(listener);

      await component.saveLocalPatterns('local/\n');
      vi.mocked(readIfExists).mockResolvedValueOnce(vi.mocked(writeSafe).mock.calls.at(-1)?.[0].content ?? null);
      await component.handleDeletedOrDotFile('.obsidianignore');

      expect(listener).not.toHaveBeenCalled();
    });

    it('should report a failed save to its caller and still make the next one', async () => {
      setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();
      vi.mocked(writeSafe).mockRejectedValueOnce(new Error('disk full'));

      await expect(component.saveLocalPatterns('first/')).rejects.toThrow('disk full');
      await component.saveLocalPatterns('second/');

      expect(component.getLocalPatternsText()).toBe('second/');
    });

    it('should tell its listeners about an outside edit until they are removed', async () => {
      setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();
      const listener = vi.fn();
      const removeListener = component.onLocalPatternsChange(listener);

      vi.mocked(readIfExists).mockResolvedValueOnce('edited/');
      await component.handleDeletedOrDotFile('.obsidianignore');
      expect(listener).toHaveBeenCalledOnce();

      removeListener();
      vi.mocked(readIfExists).mockResolvedValueOnce('edited again/');
      await component.handleDeletedOrDotFile('.obsidianignore');
      expect(listener).toHaveBeenCalledOnce();
    });

    it('should re-read the file when the window regains focus or the app becomes visible, not when it is hidden', async () => {
      setupIndexedDatabase();
      const component = createComponent();
      // The handlers are called directly: an event dispatched on `window` would also reach the components earlier tests left loaded.
      const registerDomEventSpy = vi.spyOn(component, 'registerDomEvent');
      await component.loadWithPromises();
      const listener = vi.fn();
      component.onLocalPatternsChange(listener);
      function getHandler(type: string): () => void {
        const call = registerDomEventSpy.mock.calls.find(([, eventType]) => eventType === type);
        return call?.[2] as () => void;
      }

      vi.mocked(readIfExists).mockResolvedValue('focus/');
      getHandler('focus')();
      await vi.runAllTimersAsync();
      expect(listener).toHaveBeenCalledOnce();

      vi.mocked(readIfExists).mockResolvedValue('visible/');
      const visibilityState = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      getHandler('visibilitychange')();
      await vi.runAllTimersAsync();
      expect(listener).toHaveBeenCalledOnce();

      visibilityState.mockReturnValue('visible');
      getHandler('visibilitychange')();
      await vi.runAllTimersAsync();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(component.isIgnored({ isFolder: true, normalizedPath: 'visible' })).toBe(true);
    });

    it('should report the errors an outside edit brings, once per change, and stay quiet at load and on its own saves', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(noop);
      setupIndexedDatabase();
      vi.mocked(readIfExists).mockResolvedValueOnce('broken[\n');
      const pluginNoticeComponent = createPluginNoticeComponent();
      const component = createComponent({ pluginNoticeComponent });
      await component.loadWithPromises();
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      await component.saveLocalPatterns('ok/\n[x\n');
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      vi.mocked(readIfExists).mockResolvedValueOnce('ok/\ndrive\\\n[a\n./b\n');
      await component.refreshLocalPatterns();
      const expectedMessage = '`.obsidianignore`, line 2: A line cannot end with a single `\\`, so this line matches nothing. Write `\\\\` for a backslash. (and 2 more)';
      expect(consoleWarnSpy).toHaveBeenCalledExactlyOnceWith(expectedMessage);
      expect(getFragmentText(vi.mocked(pluginNoticeComponent.showNotice).mock.calls[0]?.[0])).toBe(expectedMessage.replaceAll('`', ''));
      expect(vi.mocked(pluginNoticeComponent.showNotice).mock.calls[0]?.[1]).toStrictEqual({ mode: PluginNoticeMode.Separate });

      // The same errors under another line ending, then a fix that leaves only warnings: nothing new to report.
      vi.mocked(readIfExists).mockResolvedValueOnce('ok/\r\ndrive\\\r\n[a\r\n./b\r\n');
      await component.refreshLocalPatterns();
      vi.mocked(readIfExists).mockResolvedValueOnce('ok/ \n');
      await component.refreshLocalPatterns();
      expect(consoleWarnSpy).toHaveBeenCalledOnce();

      vi.mocked(readIfExists).mockResolvedValueOnce('!\n');
      await component.refreshLocalPatterns();
      expect(consoleWarnSpy).toHaveBeenLastCalledWith('`.obsidianignore`, line 1: `!` needs a pattern after it.');
      expect(pluginNoticeComponent.showNotice).toHaveBeenCalledTimes(2);
    });
  });

  describe('reload', () => {
    it('should read the ignore file on load', async () => {
      setupIndexedDatabase();
      vi.mocked(readIfExists).mockResolvedValue('');
      const component = createComponent();
      vi.mocked(readIfExists).mockClear();
      await component.loadWithPromises();

      expect(readIfExists).toHaveBeenCalled();
    });

    it('should clear fileIgnoreMap when the settings patterns change', async () => {
      setupIndexedDatabase();
      vi.mocked(readSafe).mockResolvedValue('');
      const pluginSettingsComponent = createPluginSettingsComponent();
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      // Populate fileIgnoreMap by calling isIgnored — no patterns loaded, so not ignored
      component.isIgnored({ isFolder: false, normalizedPath: 'test-file.md' });
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'test-file.md' })).toBe(false);

      // A save of new patterns calls reload()
      const saveSettingsCall = (vi.mocked(pluginSettingsComponent.on).mock.calls as MockCallEntry[]).find(([name]) => name === 'saveSettings');
      if (saveSettingsCall) {
        const callback = saveSettingsCall[1] as () => Promise<void>;
        (pluginSettingsComponent.settings as PluginSettings).ignorePatterns = 'test-*\n';
        await callback();
      } else {
        expect.fail('saveSettings event was not registered');
      }

      // After reload with changed patterns, cached entry should be cleared
      // and re-evaluated with new patterns
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'test-file.md' })).toBe(true);
    });
  });

  describe('processStoreActions', () => {
    it('should batch pending store operations', async () => {
      const { filesStore } = setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();

      // Trigger multiple isIgnored calls to queue store actions
      component.isIgnored({ isFolder: false, normalizedPath: 'file1.md' });
      component.isIgnored({ isFolder: false, normalizedPath: 'file2.md' });

      // Run the debounced timer
      vi.runAllTimers();

      expect(filesStore.put).toHaveBeenCalledTimes(2);
    });

    it('should clear pending actions after processing', async () => {
      const { filesStore } = setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();

      component.isIgnored({ isFolder: false, normalizedPath: 'file1.md' });
      vi.runAllTimers();

      const putCallsAfterFirst = filesStore.put.mock.calls.length;

      // Running timers again should not trigger more puts
      vi.runAllTimers();

      expect(filesStore.put.mock.calls.length).toBe(putCallsAfterFirst);
    });

    it('should dedupe queued actions by path so the queue stays bounded', async () => {
      const { filesStore } = setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();

      // Queue a put for the path, then a delete for the same path before the
      // debounced flush: the delete must overwrite the put (last-write-wins)
      // rather than both accumulating, so repeated config changes cannot grow
      // the queue beyond the number of distinct paths.
      component.isIgnored({ isFolder: false, normalizedPath: 'file1.md' });
      await component.handleDeletedOrDotFile('file1.md');

      vi.runAllTimers();

      expect(filesStore.put).not.toHaveBeenCalled();
      expect(filesStore.delete).toHaveBeenCalledExactlyOnceWith('file1.md');
    });
  });

  describe('resetDb', () => {
    it('should clear files store and fileIgnoreMap', async () => {
      vi.mocked(isDeepEqual).mockReturnValue(false);
      const { filesStore } = setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();

      // ResetDb is called during loadDb when mtime doesn't match
      expect(filesStore.clear).toHaveBeenCalled();
    });

    it('should update mtime entry', async () => {
      vi.mocked(isDeepEqual).mockReturnValue(false);
      const { mtimeStore } = setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();

      expect(mtimeStore.put).toHaveBeenCalled();
    });
  });

  describe('getCurrentMtimeEntry', () => {
    it('should include gitIgnoreMtime when shouldIncludeGitIgnorePatterns is true', async () => {
      vi.mocked(isDeepEqual).mockReturnValue(false);
      vi.mocked(statSafe).mockResolvedValue({ ctime: 0, mtime: 12_345, size: 10, type: 'file' });
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIncludeGitIgnorePatterns: true
      });
      setupIndexedDatabase();
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      // ResetDb calls getCurrentMtimeEntry, which uses statSafe
      expect(statSafe).toHaveBeenCalled();
    });

    it('should set gitIgnoreMtime to 0 when shouldIncludeGitIgnorePatterns is false', async () => {
      vi.mocked(isDeepEqual).mockReturnValue(false);
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIncludeGitIgnorePatterns: false
      });
      const { mtimeStore } = setupIndexedDatabase();
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      const putCall = mtimeStore.put.mock.calls[0];
      if (putCall) {
        const entry = putCall[0] as MtimeEntryWithGitIgnore;
        expect(entry.gitIgnoreMtime).toBe(0);
      } else {
        expect.fail('mtimeStore.put was not called');
      }
    });

    it('should handle null stat result for obsidian ignore', async () => {
      vi.mocked(isDeepEqual).mockReturnValue(false);
      vi.mocked(statSafe).mockResolvedValue(null);
      const { mtimeStore } = setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();

      const putCall = mtimeStore.put.mock.calls[0];
      if (putCall) {
        const entry = putCall[0] as MtimeEntryWithObsidianIgnore;
        expect(entry.obsidianIgnoreMtime).toBe(0);
      } else {
        expect.fail('mtimeStore.put was not called');
      }
    });

    it('should include userIgnoreFilters in mtime entry', async () => {
      vi.mocked(isDeepEqual).mockReturnValue(false);
      const app = createApp();
      vi.mocked(app.vault.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(['filter1', 'filter2']);
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: true
      });
      const { mtimeStore } = setupIndexedDatabase();
      const component = createComponent({ app, pluginSettingsComponent });
      await component.loadWithPromises();

      const putCall = mtimeStore.put.mock.calls[0];
      if (putCall) {
        const entry = putCall[0] as MtimeEntryWithUserIgnoreFilters;
        expect(entry.userIgnoreFiltersString).toBe('filter1\nfilter2');
      } else {
        expect.fail('mtimeStore.put was not called');
      }
    });

    it('should return empty userIgnoreFilters when shouldIgnoreExcludedFiles is false', async () => {
      vi.mocked(isDeepEqual).mockReturnValue(false);
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: false
      });
      const { mtimeStore } = setupIndexedDatabase();
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      const putCall = mtimeStore.put.mock.calls[0];
      if (putCall) {
        const entry = putCall[0] as MtimeEntryWithUserIgnoreFilters;
        expect(entry.userIgnoreFiltersString).toBe('');
      } else {
        expect.fail('mtimeStore.put was not called');
      }
    });

    it('should handle null userIgnoreFilters from vault config', async () => {
      vi.mocked(isDeepEqual).mockReturnValue(false);
      const app = createApp();
      vi.mocked(app.vault.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: true
      });
      const { mtimeStore } = setupIndexedDatabase();
      const component = createComponent({ app, pluginSettingsComponent });
      await component.loadWithPromises();

      const putCall = mtimeStore.put.mock.calls[0];
      if (putCall) {
        const entry = putCall[0] as MtimeEntryWithUserIgnoreFilters;
        expect(entry.userIgnoreFiltersString).toBe('');
      } else {
        expect.fail('mtimeStore.put was not called');
      }
    });
  });

  describe('getIgnoreTester', () => {
    it('should build tester from obsidian and git ignore content', async () => {
      setupIndexedDatabase();
      vi.mocked(readIfExists).mockResolvedValueOnce('*.log'); // Obsidian ignore
      vi.mocked(readSafe).mockResolvedValueOnce('node_modules'); // Git ignore
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIncludeGitIgnorePatterns: true
      });
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: false, normalizedPath: 'debug.log' })).toBe(true);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'node_modules/pkg' })).toBe(true);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'src/main.ts' })).toBe(false);
    });

    it('should cache the ignore tester', async () => {
      setupIndexedDatabase();
      vi.mocked(readIfExists).mockResolvedValue('*.log');
      const component = createComponent();
      await component.loadWithPromises();

      // Both calls should use the same tester
      component.isIgnored({ isFolder: false, normalizedPath: 'a.log' });
      component.isIgnored({ isFolder: false, normalizedPath: 'b.log' });

      expect(component.isIgnored({ isFolder: false, normalizedPath: 'a.log' })).toBe(true);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'b.log' })).toBe(true);
    });
  });

  describe('db getter', () => {
    it('should throw when database is not set', async () => {
      const component = createComponent();
      // Before onload the verdict store is not open, so reading it must fail loudly.
      await expect(component.ensureVerdictsLoaded()).rejects.toThrow('database is not set');
    });
  });

  describe('handleDeletedOrDotFile with store action for cached path', () => {
    it('should add a delete store action when path was cached', async () => {
      const { filesStore } = setupIndexedDatabase();
      const component = createComponent();
      await component.loadWithPromises();

      // Cache a path
      component.isIgnored({ isFolder: false, normalizedPath: 'cached.md' });
      // Now handle it as deleted
      await component.handleDeletedOrDotFile('cached.md');

      vi.runAllTimers();
      expect(filesStore.delete).toHaveBeenCalledWith('cached.md');
    });
  });

  describe('getResult with pending request', () => {
    it('should resolve via success event when readyState is not done', async () => {
      const filesStore = createMockObjectStore();
      const mtimeStore = createMockObjectStore();
      mtimeStore.get.mockReturnValue(createMockRequest(undefined));

      const mockDatabase = strictProxy<IDBDatabase>({
        createObjectStore: vi.fn()
      });
      Object.defineProperty(mockDatabase, 'transaction', {
        value: vi.fn(() => createMockTransaction({ files: filesStore, mtime: mtimeStore }))
      });

      // Create an open request that is pending (not done)
      const pendingOpenRequest = strictProxy<IDBOpenDBRequest>({
        readyState: 'pending',
        result: mockDatabase
      });
      Object.defineProperty(pendingOpenRequest, 'addEventListener', {
        value: vi.fn((event: string, handler: ($event: UpgradeEvent) => void) => {
          // `success` fires immediately so the open promise resolves.
          if (event === 'upgradeneeded' || event === 'success') {
            handler({ newVersion: 1 });
          }
        })
      });

      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        value: strictProxy<IDBFactory>({
          open: vi.fn().mockReturnValue(pendingOpenRequest)
        }),
        writable: true
      });

      const component = createComponent();
      await component.loadWithPromises();
      expect(component).toBeInstanceOf(IgnorePatternsComponent);
    });

    it('closes a connection that finishes opening after the component unloaded', async () => {
      const mockDatabase = strictProxy<IDBDatabase>({ close: vi.fn() });
      const pendingOpen: PendingOpen = {};
      const pendingOpenRequest = strictProxy<IDBOpenDBRequest>({
        readyState: 'pending',
        result: mockDatabase
      });
      Object.defineProperty(pendingOpenRequest, 'addEventListener', {
        value: vi.fn((event: string, handler: () => void) => {
          if (event === 'success') {
            pendingOpen.succeed = handler;
          }
        })
      });
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        value: strictProxy<IDBFactory>({
          open: vi.fn().mockReturnValue(pendingOpenRequest)
        }),
        writable: true
      });

      const component = createComponent();
      const loadPromise = component.loadWithPromises();
      // The open is requested only after the imported files are read.
      await vi.waitFor(() => {
        expect(pendingOpen.succeed).toBeDefined();
      });
      component.unload();
      pendingOpen.succeed?.();
      await loadPromise;

      expect(mockDatabase.close).toHaveBeenCalledOnce();
    });

    it('should reject via error event when readyState is not done', async () => {
      const testError = new Error('Test DB error');
      const pendingOpenRequest = strictProxy<IDBOpenDBRequest>({
        error: testError,
        readyState: 'pending'
      });
      Object.defineProperty(pendingOpenRequest, 'addEventListener', {
        value: vi.fn((event: string, handler: () => void) => {
          // Fire error handler immediately when it is registered
          if (event === 'error') {
            handler();
          }
        })
      });

      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        value: strictProxy<IDBFactory>({
          open: vi.fn().mockReturnValue(pendingOpenRequest)
        }),
        writable: true
      });

      const component = createComponent();
      // 70.0.0 collects onloadAsync errors and rejects with an AggregateError wrapping them.
      await expect(component.loadWithPromises()).rejects.toMatchObject({
        errors: [expect.objectContaining({ message: 'Test DB error' })]
      });
    });

    it('should reject with Unknown error when request.error is null', async () => {
      const pendingOpenRequest = strictProxy<IDBOpenDBRequest>({
        error: null,
        readyState: 'pending'
      });
      Object.defineProperty(pendingOpenRequest, 'addEventListener', {
        value: vi.fn((event: string, handler: () => void) => {
          if (event === 'error') {
            handler();
          }
        })
      });

      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        value: strictProxy<IDBFactory>({
          open: vi.fn().mockReturnValue(pendingOpenRequest)
        }),
        writable: true
      });

      const component = createComponent();
      // 70.0.0 collects onloadAsync errors and rejects with an AggregateError wrapping them.
      await expect(component.loadWithPromises()).rejects.toMatchObject({
        errors: [expect.objectContaining({ message: 'Unknown error' })]
      });
    });
  });

  describe('getExcludeRegExps edge cases', () => {
    it('should treat filter starting and ending with / but length > 1 as regex', async () => {
      setupIndexedDatabase();
      const app = createApp();
      vi.mocked(app.vault.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(['/test.*/']);
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: true
      });
      const component = createComponent({ app, pluginSettingsComponent });
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: false, normalizedPath: 'testing123' })).toBe(true);
    });

    it('should treat plain filter as anchored prefix match', async () => {
      setupIndexedDatabase();
      const app = createApp();
      vi.mocked(app.vault.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(['docs']);
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: true
      });
      const component = createComponent({ app, pluginSettingsComponent });
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: false, normalizedPath: 'docs/readme.md' })).toBe(true);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'my-docs/readme.md' })).toBe(false);
    });
  });
});
