import type {
  App as AppOriginal,
  EventRef
} from 'obsidian';

import { invokeAsyncSafelyAfterDelay } from 'obsidian-dev-utils/async';
import {
  castTo,
  deepEqual
} from 'obsidian-dev-utils/object-utils';
import { registerAsyncEvent } from 'obsidian-dev-utils/obsidian/components/async-events-component';
import { ensureMetadataCacheReady } from 'obsidian-dev-utils/obsidian/metadata-cache';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { VaultLoadPatchComponent } from './patches/vault-load-patch-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import {
  readSafe,
  statSafe,
  writeSafe
} from './data-adapter-safe.ts';
import { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import { PluginSettings } from './plugin-settings.ts';

vi.mock('./data-adapter-safe.ts', () => ({
  readSafe: vi.fn().mockResolvedValue(''),
  statSafe: vi.fn().mockResolvedValue(null),
  writeSafe: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('obsidian-dev-utils/obsidian/metadata-cache', () => ({
  ensureMetadataCacheReady: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('obsidian-dev-utils/obsidian/components/async-events-component', () => ({
  registerAsyncEvent: vi.fn()
}));

// Keep the REAL invokeAsyncSafelyAfterDelay (so its genuine dev-utils scheduling/error-handling runs).
// It is wrapped in a vi.fn pass-through purely so tests can assert it was invoked.
// The real body is not re-created: vi.fn delegates every call to actual.invokeAsyncSafelyAfterDelay unchanged.
vi.mock('obsidian-dev-utils/async', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian-dev-utils/async')>();
  return {
    ...actual,
    invokeAsyncSafelyAfterDelay: vi.fn(actual.invokeAsyncSafelyAfterDelay)
  };
});

vi.mock('obsidian-dev-utils/object-utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian-dev-utils/object-utils')>(),
  deepEqual: vi.fn().mockReturnValue(true)
}));

interface CreateComponentOverrides {
  app?: AppOriginal;
  onUpdateFileTree?(): Promise<void>;
  pluginSettingsComponent?: PluginSettingsComponent;
  vaultLoadPatch?: VaultLoadPatchComponent;
}

interface FileIgnoreEntry {
  isIgnored: boolean;
  path: string;
}

type MockCallEntry = [string, (...args: unknown[]) => unknown];

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
  userIgnoreFiltersStr: string;
}

interface SaveSettingsEffectiveValues {
  obsidianIgnoreContent: string;
}

interface SaveSettingsState {
  effectiveValues: SaveSettingsEffectiveValues;
}

interface SetupIndexedDbParams {
  readonly filesEntries?: FileIgnoreEntry[];
  readonly mtimeEntry?: unknown;
  readonly upgradeNewVersion?: number;
}

interface SetupIndexedDbResult {
  readonly filesStore: MockIDBObjectStore;
  readonly mockDb: IDBDatabase;
  readonly mtimeStore: MockIDBObjectStore;
  readonly openFn: ReturnType<typeof vi.fn>;
}

interface TestableIgnorePatternsComponent {
  clearCachedExcludeRegExps(): void;
  writeObsidianIgnore(obsidianIgnoreContent: string): Promise<void>;
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
    onUpdateFileTree: overrides?.onUpdateFileTree ?? vi.fn().mockResolvedValue(undefined),
    pluginSettingsComponent: overrides?.pluginSettingsComponent ?? createPluginSettingsComponent(),
    vaultLoadPatch: overrides?.vaultLoadPatch ?? createVaultLoadPatch()
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

function createPluginSettingsComponent(settings?: Partial<PluginSettings>): PluginSettingsComponent {
  const effectiveSettings = new PluginSettings();
  if (settings) {
    Object.assign(effectiveSettings, settings);
  }

  return strictProxy<PluginSettingsComponent>({
    on: vi.fn().mockReturnValue(strictProxy<EventRef>({})),
    setProperty: vi.fn().mockResolvedValue(''),
    settings: effectiveSettings
  });
}

function createVaultLoadPatch(vaultLoadCalled = false): VaultLoadPatchComponent {
  return strictProxy<VaultLoadPatchComponent>({
    vaultLoadCalled
  });
}

function setupIndexedDb(params?: SetupIndexedDbParams): SetupIndexedDbResult {
  const filesStore = createMockObjectStore(params?.filesEntries ?? []);
  const mtimeStore = createMockObjectStore();
  mtimeStore.get.mockReturnValue(createMockRequest(params?.mtimeEntry));

  const mockDb = strictProxy<IDBDatabase>({
    createObjectStore: vi.fn()
  });
  const mockTransactionFn = vi.fn(() => createMockTransaction({ files: filesStore, mtime: mtimeStore }));
  Object.defineProperty(mockDb, 'transaction', { value: mockTransactionFn });

  const newVersion = params?.upgradeNewVersion ?? 1;

  const mockAddEventListener = vi.fn((event: string, handler: (ev: UpgradeEvent) => void) => {
    if (event === 'upgradeneeded') {
      handler({ newVersion });
    }
  });
  const openRequestProxy = strictProxy<IDBOpenDBRequest>({
    readyState: 'done',
    result: mockDb
  });
  Object.defineProperty(openRequestProxy, 'addEventListener', { value: mockAddEventListener });

  const openFn = vi.fn().mockReturnValue(openRequestProxy);

  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: strictProxy<IDBFactory>({
      open: openFn
    }),
    writable: true
  });

  return { filesStore, mockDb, mtimeStore, openFn };
}

describe('IgnorePatternsComponent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    // Flush delayed async operations scheduled via the real invokeAsyncSafelyAfterDelay.
    // This lets obsidian-dev-utils' async-operation tracking settle them.
    // Otherwise its global afterEach waitForAllAsyncOperations hangs for the full hook timeout on a scheduled-but-never-run op.
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create an instance', () => {
      setupIndexedDb();
      const component = createComponent();
      expect(component).toBeInstanceOf(IgnorePatternsComponent);
    });
  });

  describe('isIgnored', () => {
    it('should return false for ROOT_PATH', () => {
      setupIndexedDb();
      const component = createComponent();
      expect(component.isIgnored({ isFolder: false, normalizedPath: '/' })).toBe(false);
    });

    it('should return cached result when available', async () => {
      setupIndexedDb();
      const component = createComponent();
      await component.loadWithPromises();

      // First call caches the result
      const result1 = component.isIgnored({ isFolder: false, normalizedPath: 'some/file.md' });
      // Second call should return the same result from cache
      const result2 = component.isIgnored({ isFolder: false, normalizedPath: 'some/file.md' });

      expect(result1).toBe(result2);
      expect(result2).toBe(false);
    });

    it('should test against ignore patterns for files', async () => {
      setupIndexedDb();
      const pluginSettingsComponent = createPluginSettingsComponent();
      vi.mocked(readSafe).mockResolvedValueOnce('*.log');
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: false, normalizedPath: 'debug.log' })).toBe(true);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'readme.md' })).toBe(false);
    });

    it('should test both path and path/ for folders', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValueOnce('build/');
      const component = createComponent();
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: true, normalizedPath: 'build' })).toBe(true);
    });

    it('should test exclude regexps when shouldIgnoreExcludedFiles is true', async () => {
      setupIndexedDb();
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
      setupIndexedDb();
      const app = createApp();
      vi.mocked(app.vault.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(['/\\.tmp$/']);
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: true
      });
      const component = createComponent({ app, pluginSettingsComponent });
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: false, normalizedPath: 'file.tmp' })).toBe(true);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'file.md' })).toBe(false);
    });

    it('should handle invalid regex filters gracefully', async () => {
      setupIndexedDb();
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
      setupIndexedDb();
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
      setupIndexedDb();
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

      // GetConfig should be called for the first isIgnored, but the second should use cached regexps.
      // We can verify by checking that both return true (i.e., the pattern was applied)
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'secret/file.md' })).toBe(true);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'secret/other.md' })).toBe(true);
    });

    it('should handle single-character filter that looks like regex delimiter', async () => {
      setupIndexedDb();
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
      const { filesStore } = setupIndexedDb();
      const component = createComponent();
      await component.loadWithPromises();

      component.isIgnored({ isFolder: false, normalizedPath: 'test.md' });

      // Trigger the debounced store actions
      vi.runAllTimers();

      expect(filesStore.put).toHaveBeenCalled();
    });

    it('should not ignore a folder re-included by the negation whitelist idiom', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValueOnce('*\n!*/\n!*.md\n!*.canvas\n!*.base');
      const component = createComponent();
      await component.loadWithPromises();

      // `!*/` re-includes directories, so folders must test not-ignored for traversal to descend.
      expect(component.isIgnored({ isFolder: true, normalizedPath: 'sub' })).toBe(false);
      expect(component.isIgnored({ isFolder: true, normalizedPath: 'sub/nested' })).toBe(false);
    });

    it('should re-include whitelisted file extensions and ignore the rest under the negation idiom', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValueOnce('*\n!*/\n!*.md\n!*.canvas\n!*.base');
      const component = createComponent();
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: false, normalizedPath: 'sub/note.md' })).toBe(false);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'top.canvas' })).toBe(false);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'sub/data.base' })).toBe(false);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'sub/image.png' })).toBe(true);
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'sub/note.txt' })).toBe(true);
    });

    it('should still ignore a folder matched by a dir-only or plain pattern', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValueOnce('build/\nnode_modules\n');
      const component = createComponent();
      await component.loadWithPromises();

      expect(component.isIgnored({ isFolder: true, normalizedPath: 'build' })).toBe(true);
      expect(component.isIgnored({ isFolder: true, normalizedPath: 'node_modules' })).toBe(true);
    });
  });

  describe('clearCachedExcludeRegExps', () => {
    it('should clear cached regexps', async () => {
      setupIndexedDb();
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
      setupIndexedDb();
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
      setupIndexedDb();
      const component = createComponent();
      await component.loadWithPromises();

      // Populate the cache
      component.isIgnored({ isFolder: false, normalizedPath: 'test.md' });

      await component.handleDeletedOrDotFile('test.md');
      // After deletion, should recalculate
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'test.md' })).toBe(false);
    });

    it('should not add store action when path is not in fileIgnoreMap', async () => {
      const { filesStore } = setupIndexedDb();
      const component = createComponent();
      await component.loadWithPromises();

      await component.handleDeletedOrDotFile('nonexistent.md');

      vi.runAllTimers();
      // The put from initial isIgnored should not be present since we never called isIgnored
      expect(filesStore.delete).not.toHaveBeenCalled();
    });

    it('should re-read obsidian ignore when path matches', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValue('');
      const component = createComponent();
      await component.loadWithPromises();

      vi.mocked(readSafe).mockResolvedValueOnce('new-pattern');
      await component.handleDeletedOrDotFile('.obsidianignore');

      expect(readSafe).toHaveBeenCalled();
    });

    it('should re-read git ignore when path matches', async () => {
      setupIndexedDb();
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

    it('should not trigger processConfigChanges when ignore file content is unchanged', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValue('');
      const component = createComponent();
      await component.loadWithPromises();

      vi.mocked(invokeAsyncSafelyAfterDelay).mockClear();
      // ReadSafe returns '' which matches the initial cached content
      vi.mocked(readSafe).mockResolvedValueOnce('');
      await component.handleDeletedOrDotFile('.obsidianignore');

      expect(invokeAsyncSafelyAfterDelay).not.toHaveBeenCalled();
    });

    it('should handle a path that is in the fileIgnoreMap and also an ignore file', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValue('');
      const component = createComponent();
      await component.loadWithPromises();

      // Populate cache with the obsidian ignore file path
      component.isIgnored({ isFolder: false, normalizedPath: '.obsidianignore' });

      vi.mocked(readSafe).mockResolvedValueOnce('changed-content');
      await component.handleDeletedOrDotFile('.obsidianignore');

      expect(invokeAsyncSafelyAfterDelay).toHaveBeenCalled();

      // Drain the scheduled processConfigChanges so its callback actually runs.
      await vi.runAllTimersAsync();
    });
  });

  describe('processConfigChanges', () => {
    it('should no-op when hadConfigChanges is false', async () => {
      setupIndexedDb();
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const component = createComponent({ onUpdateFileTree });
      await component.loadWithPromises();

      await component.processConfigChanges();

      expect(onUpdateFileTree).not.toHaveBeenCalled();
    });

    it('should reset DB and call onUpdateFileTree when hadConfigChanges is true', async () => {
      setupIndexedDb();
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const pluginSettingsComponent = createPluginSettingsComponent();
      const component = createComponent({ onUpdateFileTree, pluginSettingsComponent });
      await component.loadWithPromises();

      // We need to simulate the saveSettings event. Since registerAsyncEvent is mocked,
      // We access the on() calls on pluginSettingsComponent
      const onCalls = vi.mocked(pluginSettingsComponent.on).mock.calls as MockCallEntry[];
      const saveSettingsCall = onCalls.find(([name]) => name === 'saveSettings');

      if (saveSettingsCall) {
        const callback = saveSettingsCall[1] as (state: SaveSettingsState) => Promise<void>;
        await callback({ effectiveValues: { obsidianIgnoreContent: 'test' } });
      }

      await component.processConfigChanges();

      expect(onUpdateFileTree).toHaveBeenCalled();
    });
  });

  describe('writeObsidianIgnore', () => {
    it('should no-op when content is unchanged', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValue('existing-content');
      const component = createComponent();
      await component.loadWithPromises();

      vi.mocked(writeSafe).mockClear();
      await castTo<TestableIgnorePatternsComponent>(component).writeObsidianIgnore('existing-content');

      expect(writeSafe).not.toHaveBeenCalled();
    });

    it('should write file and update settings when content changes', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValue('');
      const pluginSettingsComponent = createPluginSettingsComponent();
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      await castTo<TestableIgnorePatternsComponent>(component).writeObsidianIgnore('new-content');

      expect(writeSafe).toHaveBeenCalled();
      expect(pluginSettingsComponent.setProperty).toHaveBeenCalledWith('obsidianIgnoreContent', 'new-content');
    });

    it('should not write again if called with the same new content twice', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValue('');
      const component = createComponent();
      await component.loadWithPromises();

      vi.mocked(writeSafe).mockClear();
      await castTo<TestableIgnorePatternsComponent>(component).writeObsidianIgnore('new-content');
      vi.mocked(writeSafe).mockClear();
      await castTo<TestableIgnorePatternsComponent>(component).writeObsidianIgnore('new-content');

      expect(writeSafe).not.toHaveBeenCalled();
    });
  });

  describe('onLayoutReady', () => {
    it('should call ensureMetadataCacheReady', async () => {
      setupIndexedDb();
      const component = createComponent();
      await component.loadWithPromises();
      await component.invokeOnLayoutReady();

      expect(ensureMetadataCacheReady).toHaveBeenCalled();
    });

    it('should call onUpdateFileTree when vaultLoadCalled is false', async () => {
      setupIndexedDb();
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const vaultLoadPatch = createVaultLoadPatch(false);
      const component = createComponent({ onUpdateFileTree, vaultLoadPatch });
      await component.loadWithPromises();
      await component.invokeOnLayoutReady();

      expect(onUpdateFileTree).toHaveBeenCalled();
    });

    it('should not call onUpdateFileTree when vaultLoadCalled is true', async () => {
      setupIndexedDb();
      const onUpdateFileTree = vi.fn().mockResolvedValue(undefined);
      const vaultLoadPatch = createVaultLoadPatch(true);
      const component = createComponent({ onUpdateFileTree, vaultLoadPatch });
      await component.loadWithPromises();
      await component.invokeOnLayoutReady();

      expect(onUpdateFileTree).not.toHaveBeenCalled();
    });

    it('should register config-changed event handler', async () => {
      setupIndexedDb();
      const app = createApp();
      const vaultOnSpy = vi.spyOn(app.vault, 'on');
      const component = createComponent({ app });
      await component.loadWithPromises();
      await component.invokeOnLayoutReady();

      expect(vaultOnSpy).toHaveBeenCalledWith('config-changed', expect.any(Function));
    });

    it('should call clearCachedExcludeRegExps when config-changed fires with userIgnoreFilters', async () => {
      setupIndexedDb();
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
      setupIndexedDb();
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
      const { openFn } = setupIndexedDb();
      const component = createComponent();
      await component.loadWithPromises();

      expect(openFn).toHaveBeenCalled();
      expect(readSafe).toHaveBeenCalled();
    });

    it('should register loadSettings and saveSettings event handlers', async () => {
      setupIndexedDb();
      const pluginSettingsComponent = createPluginSettingsComponent();
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      // RegisterAsyncEvent is called for loadSettings and saveSettings from this component;
      // But it may also be called by other components in the chain. Just check it was called.
      expect(registerAsyncEvent).toHaveBeenCalled();
      expect(pluginSettingsComponent.on).toHaveBeenCalledWith('loadSettings', expect.any(Function));
      expect(pluginSettingsComponent.on).toHaveBeenCalledWith('saveSettings', expect.any(Function));
    });

    it('should handle loadSettings event on non-initial load', async () => {
      setupIndexedDb();
      const pluginSettingsComponent = createPluginSettingsComponent();
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      const loadSettingsCall = (vi.mocked(pluginSettingsComponent.on).mock.calls as MockCallEntry[]).find(([name]) => name === 'loadSettings');
      if (loadSettingsCall) {
        const callback = loadSettingsCall[1] as (_loadedState: unknown, isInitialLoad: boolean) => Promise<void>;
        vi.mocked(readSafe).mockClear();
        await callback(undefined, false);
        expect(readSafe).toHaveBeenCalled();
      } else {
        expect.fail('loadSettings event was not registered');
      }
    });

    it('should skip readObsidianIgnore on initial loadSettings', async () => {
      setupIndexedDb();
      const pluginSettingsComponent = createPluginSettingsComponent();
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      const loadSettingsCall = (vi.mocked(pluginSettingsComponent.on).mock.calls as MockCallEntry[]).find(([name]) => name === 'loadSettings');
      if (loadSettingsCall) {
        const callback = loadSettingsCall[1] as (_loadedState: unknown, isInitialLoad: boolean) => Promise<void>;
        vi.mocked(readSafe).mockClear();
        await callback(undefined, true);
        expect(readSafe).not.toHaveBeenCalled();
      } else {
        expect.fail('loadSettings event was not registered');
      }
    });

    it('should handle saveSettings event', async () => {
      setupIndexedDb();
      const pluginSettingsComponent = createPluginSettingsComponent();
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      const saveSettingsCall = (vi.mocked(pluginSettingsComponent.on).mock.calls as MockCallEntry[]).find(([name]) => name === 'saveSettings');
      if (saveSettingsCall) {
        const callback = saveSettingsCall[1] as (newState: SaveSettingsState) => Promise<void>;
        await callback({ effectiveValues: { obsidianIgnoreContent: 'new-pattern' } });

        // HadConfigChanges should be set to true, verifiable by processConfigChanges doing work
        // We cannot easily re-inject onUpdateFileTree, so just verify no error
        expect(writeSafe).toHaveBeenCalled();
      } else {
        expect.fail('saveSettings event was not registered');
      }
    });
  });

  describe('config fingerprint and lazy verdict loading', () => {
    it('should open IndexedDB with correct name', async () => {
      const { openFn } = setupIndexedDb();
      const app = createApp();
      const component = createComponent({ app });
      await component.loadWithPromises();

      expect(openFn).toHaveBeenCalledWith('test-app/advanced-exclude', 1);
    });

    it('should create object stores on upgradeneeded with newVersion 1', async () => {
      const { mockDb } = setupIndexedDb();
      const component = createComponent();
      await component.loadWithPromises();

      expect(mockDb.createObjectStore).toHaveBeenCalledTimes(2);
    });

    it('should skip object store creation when newVersion is not 1', async () => {
      const { mockDb } = setupIndexedDb({ upgradeNewVersion: 2 });
      const component = createComponent();
      await component.loadWithPromises();

      expect(mockDb.createObjectStore).not.toHaveBeenCalled();
    });

    it('marks the config unchanged and defers the verdict getAll when mtime matches', async () => {
      vi.mocked(deepEqual).mockReturnValue(true);
      const { filesStore } = setupIndexedDb({
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
      vi.mocked(deepEqual).mockReturnValue(true);
      const { filesStore } = setupIndexedDb({ filesEntries: [{ isIgnored: true, path: 'ignored.md' }] });
      const component = createComponent();
      await component.loadWithPromises();

      await component.ensureVerdictsLoaded();
      await component.ensureVerdictsLoaded();
      expect(filesStore.getAll).toHaveBeenCalledTimes(1);
    });

    it('resets the DB and reports the config changed when mtime does not match', async () => {
      vi.mocked(deepEqual).mockReturnValue(false);
      const { filesStore } = setupIndexedDb({
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
      vi.mocked(deepEqual).mockReturnValue(true);
      setupIndexedDb({ mtimeEntry: undefined });
      const component = createComponent();
      await component.loadWithPromises();

      expect(deepEqual).toHaveBeenCalled();
    });
  });

  describe('readGitIgnore', () => {
    it('should not read git ignore when shouldIncludeGitIgnorePatterns is false', async () => {
      setupIndexedDb();
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIncludeGitIgnorePatterns: false
      });
      const component = createComponent({ pluginSettingsComponent });
      vi.mocked(readSafe).mockClear();
      await component.loadWithPromises();

      // ReadSafe should only be called for obsidian ignore, not git ignore
      const readSafeCalls = vi.mocked(readSafe).mock.calls;
      const gitIgnoreReads = readSafeCalls.filter(([, path]) => path === '.gitignore');
      expect(gitIgnoreReads).toHaveLength(0);
    });

    it('should read git ignore when shouldIncludeGitIgnorePatterns is true', async () => {
      setupIndexedDb();
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIncludeGitIgnorePatterns: true
      });
      vi.mocked(readSafe).mockResolvedValue('');
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      expect(readSafe).toHaveBeenCalled();
    });

    it('should detect git ignore content changes', async () => {
      setupIndexedDb();
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
    it('should read obsidian ignore and update settings on content change', async () => {
      setupIndexedDb();
      const pluginSettingsComponent = createPluginSettingsComponent();
      vi.mocked(readSafe).mockResolvedValue('initial-content');
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      expect(pluginSettingsComponent.setProperty).toHaveBeenCalledWith('obsidianIgnoreContent', 'initial-content');
    });

    it('should return false when content is unchanged', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValue('');
      const component = createComponent();
      await component.loadWithPromises();

      // Trigger readObsidianIgnore again with same content
      vi.mocked(readSafe).mockResolvedValueOnce('');
      await component.handleDeletedOrDotFile('.obsidianignore');

      // No processConfigChanges should be invoked
      vi.mocked(invokeAsyncSafelyAfterDelay).mockClear();
      // Content hasn't changed, so shouldRefresh should be false
      expect(invokeAsyncSafelyAfterDelay).not.toHaveBeenCalled();
    });
  });

  describe('reload', () => {
    it('should call writeObsidianIgnore when obsidianIgnoreContent is provided', async () => {
      setupIndexedDb();
      const pluginSettingsComponent = createPluginSettingsComponent();
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      // Trigger saveSettings which calls reload with content
      const saveSettingsCall = (vi.mocked(pluginSettingsComponent.on).mock.calls as MockCallEntry[]).find(([name]) => name === 'saveSettings');
      if (saveSettingsCall) {
        const callback = saveSettingsCall[1] as (newState: SaveSettingsState) => Promise<void>;
        vi.mocked(writeSafe).mockClear();
        await callback({ effectiveValues: { obsidianIgnoreContent: 'new-content' } });
        expect(writeSafe).toHaveBeenCalled();
      } else {
        expect.fail('saveSettings event was not registered');
      }
    });

    it('should call readObsidianIgnore when obsidianIgnoreContent is undefined', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValue('');
      const component = createComponent();
      vi.mocked(readSafe).mockClear();
      await component.loadWithPromises();

      // Onload calls reload() without argument, which triggers readObsidianIgnore
      expect(readSafe).toHaveBeenCalled();
    });

    it('should clear fileIgnoreMap when obsidianignore patterns change', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValue('');
      const pluginSettingsComponent = createPluginSettingsComponent();
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      // Populate fileIgnoreMap by calling isIgnored — no patterns loaded, so not ignored
      component.isIgnored({ isFolder: false, normalizedPath: 'test-file.md' });
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'test-file.md' })).toBe(false);

      // Trigger saveSettings with new obsidianignore content, which calls reload()
      const saveSettingsCall = (vi.mocked(pluginSettingsComponent.on).mock.calls as MockCallEntry[]).find(([name]) => name === 'saveSettings');
      if (saveSettingsCall) {
        const callback = saveSettingsCall[1] as (newState: SaveSettingsState) => Promise<void>;
        await callback({ effectiveValues: { obsidianIgnoreContent: 'test-*\n' } });
      } else {
        expect.fail('saveSettings event was not registered');
      }

      // After reload with changed patterns, cached entry should be cleared
      // And re-evaluated with new patterns
      expect(component.isIgnored({ isFolder: false, normalizedPath: 'test-file.md' })).toBe(true);
    });
  });

  describe('processStoreActions', () => {
    it('should batch pending store operations', async () => {
      const { filesStore } = setupIndexedDb();
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
      const { filesStore } = setupIndexedDb();
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
      const { filesStore } = setupIndexedDb();
      const component = createComponent();
      await component.loadWithPromises();

      // Queue a put for the path, then a delete for the same path before the
      // Debounced flush: the delete must overwrite the put (last-write-wins)
      // Rather than both accumulating, so repeated config changes cannot grow
      // The queue beyond the number of distinct paths.
      component.isIgnored({ isFolder: false, normalizedPath: 'file1.md' });
      await component.handleDeletedOrDotFile('file1.md');

      vi.runAllTimers();

      expect(filesStore.put).not.toHaveBeenCalled();
      expect(filesStore.delete).toHaveBeenCalledExactlyOnceWith('file1.md');
    });
  });

  describe('resetDb', () => {
    it('should clear files store and fileIgnoreMap', async () => {
      vi.mocked(deepEqual).mockReturnValue(false);
      const { filesStore } = setupIndexedDb();
      const component = createComponent();
      await component.loadWithPromises();

      // ResetDb is called during loadDb when mtime doesn't match
      expect(filesStore.clear).toHaveBeenCalled();
    });

    it('should update mtime entry', async () => {
      vi.mocked(deepEqual).mockReturnValue(false);
      const { mtimeStore } = setupIndexedDb();
      const component = createComponent();
      await component.loadWithPromises();

      expect(mtimeStore.put).toHaveBeenCalled();
    });
  });

  describe('getCurrentMtimeEntry', () => {
    it('should include gitIgnoreMtime when shouldIncludeGitIgnorePatterns is true', async () => {
      vi.mocked(deepEqual).mockReturnValue(false);
      vi.mocked(statSafe).mockResolvedValue({ ctime: 0, mtime: 12345, size: 10, type: 'file' });
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIncludeGitIgnorePatterns: true
      });
      setupIndexedDb();
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      // ResetDb calls getCurrentMtimeEntry, which uses statSafe
      expect(statSafe).toHaveBeenCalled();
    });

    it('should set gitIgnoreMtime to 0 when shouldIncludeGitIgnorePatterns is false', async () => {
      vi.mocked(deepEqual).mockReturnValue(false);
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIncludeGitIgnorePatterns: false
      });
      const { mtimeStore } = setupIndexedDb();
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
      vi.mocked(deepEqual).mockReturnValue(false);
      vi.mocked(statSafe).mockResolvedValue(null);
      const { mtimeStore } = setupIndexedDb();
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
      vi.mocked(deepEqual).mockReturnValue(false);
      const app = createApp();
      vi.mocked(app.vault.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(['filter1', 'filter2']);
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: true
      });
      const { mtimeStore } = setupIndexedDb();
      const component = createComponent({ app, pluginSettingsComponent });
      await component.loadWithPromises();

      const putCall = mtimeStore.put.mock.calls[0];
      if (putCall) {
        const entry = putCall[0] as MtimeEntryWithUserIgnoreFilters;
        expect(entry.userIgnoreFiltersStr).toBe('filter1\nfilter2');
      } else {
        expect.fail('mtimeStore.put was not called');
      }
    });

    it('should return empty userIgnoreFilters when shouldIgnoreExcludedFiles is false', async () => {
      vi.mocked(deepEqual).mockReturnValue(false);
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: false
      });
      const { mtimeStore } = setupIndexedDb();
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      const putCall = mtimeStore.put.mock.calls[0];
      if (putCall) {
        const entry = putCall[0] as MtimeEntryWithUserIgnoreFilters;
        expect(entry.userIgnoreFiltersStr).toBe('');
      } else {
        expect.fail('mtimeStore.put was not called');
      }
    });

    it('should handle null userIgnoreFilters from vault config', async () => {
      vi.mocked(deepEqual).mockReturnValue(false);
      const app = createApp();
      vi.mocked(app.vault.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const pluginSettingsComponent = createPluginSettingsComponent({
        shouldIgnoreExcludedFiles: true
      });
      const { mtimeStore } = setupIndexedDb();
      const component = createComponent({ app, pluginSettingsComponent });
      await component.loadWithPromises();

      const putCall = mtimeStore.put.mock.calls[0];
      if (putCall) {
        const entry = putCall[0] as MtimeEntryWithUserIgnoreFilters;
        expect(entry.userIgnoreFiltersStr).toBe('');
      } else {
        expect.fail('mtimeStore.put was not called');
      }
    });
  });

  describe('getIgnoreTester', () => {
    it('should build tester from obsidian and git ignore content', async () => {
      setupIndexedDb();
      vi.mocked(readSafe)
        .mockResolvedValueOnce('*.log') // Obsidian ignore
        .mockResolvedValueOnce('node_modules'); // Git ignore
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
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValue('*.log');
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
    it('should throw when db is not set', () => {
      const component = createComponent();
      // Accessing isIgnored before onload means db is not initialized,
      // But isIgnored only touches db via addStoreAction which is debounced.
      // ProcessConfigChanges accesses db through resetDb.
      // We test via processStoreActions path.
      expect(() => {
        // Force processStoreActions by calling isIgnored (adds store action)
        // Then immediately running the debounce
        component.isIgnored({ isFolder: false, normalizedPath: 'test.md' });
        // Manually trigger the debounce
        vi.runAllTimers();
      }).toThrow('db is not set');
    });
  });

  describe('handleDeletedOrDotFile with store action for cached path', () => {
    it('should add a delete store action when path was cached', async () => {
      const { filesStore } = setupIndexedDb();
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

      const mockDb = strictProxy<IDBDatabase>({
        createObjectStore: vi.fn()
      });
      Object.defineProperty(mockDb, 'transaction', {
        value: vi.fn(() => createMockTransaction({ files: filesStore, mtime: mtimeStore }))
      });

      // Create an open request that is pending (not done)
      const pendingOpenRequest = strictProxy<IDBOpenDBRequest>({
        readyState: 'pending',
        result: mockDb
      });
      Object.defineProperty(pendingOpenRequest, 'addEventListener', {
        value: vi.fn((event: string, handler: (ev: UpgradeEvent) => void) => {
          if (event === 'upgradeneeded') {
            handler({ newVersion: 1 });
          }
          if (event === 'success') {
            // Fire success immediately to resolve the promise
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
      setupIndexedDb();
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
      setupIndexedDb();
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
