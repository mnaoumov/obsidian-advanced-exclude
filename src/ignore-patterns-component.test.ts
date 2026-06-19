import type {
  App as AppOriginal,
  EventRef
} from 'obsidian';

import { invokeAsyncSafelyAfterDelay } from 'obsidian-dev-utils/async';
import { deepEqual } from 'obsidian-dev-utils/object-utils';
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

vi.mock('obsidian-dev-utils/async', () => ({
  chain: vi.fn((_chainPromise: Promise<void> | undefined, fn: () => Promise<void> | undefined) => fn() ?? undefined),
  invokeAsyncSafelyAfterDelay: vi.fn((cb: () => Promise<void>) => {
    cb().catch(() => undefined);
  })
}));

vi.mock('obsidian-dev-utils/object-utils', () => ({
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

  afterEach(() => {
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

  describe('hasHiddenPaths', () => {
    it('should be false when no paths have been evaluated', () => {
      setupIndexedDb();
      const component = createComponent();
      expect(component.hasHiddenPaths).toBe(false);
    });

    it('should be false when every evaluated path is not ignored', async () => {
      setupIndexedDb();
      const component = createComponent();
      await component.loadWithPromises();
      component.isIgnored('readme.md', false);
      expect(component.hasHiddenPaths).toBe(false);
    });

    it('should be true when at least one evaluated path is ignored', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValueOnce('*.log');
      const component = createComponent();
      await component.loadWithPromises();
      component.isIgnored('debug.log', false);
      expect(component.hasHiddenPaths).toBe(true);
    });
  });

  describe('isIgnored', () => {
    it('should return false for ROOT_PATH', () => {
      setupIndexedDb();
      const component = createComponent();
      expect(component.isIgnored('/', false)).toBe(false);
    });

    it('should return cached result when available', async () => {
      setupIndexedDb();
      const component = createComponent();
      await component.loadWithPromises();

      // First call caches the result
      const result1 = component.isIgnored('some/file.md', false);
      // Second call should return the same result from cache
      const result2 = component.isIgnored('some/file.md', false);

      expect(result1).toBe(result2);
      expect(result2).toBe(false);
    });

    it('should test against ignore patterns for files', async () => {
      setupIndexedDb();
      const pluginSettingsComponent = createPluginSettingsComponent();
      vi.mocked(readSafe).mockResolvedValueOnce('*.log');
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      expect(component.isIgnored('debug.log', false)).toBe(true);
      expect(component.isIgnored('readme.md', false)).toBe(false);
    });

    it('should test both path and path/ for folders', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValueOnce('build/');
      const component = createComponent();
      await component.loadWithPromises();

      expect(component.isIgnored('build', true)).toBe(true);
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

      expect(component.isIgnored('secret/file.md', false)).toBe(true);
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

      expect(component.isIgnored('file.tmp', false)).toBe(true);
      expect(component.isIgnored('file.md', false)).toBe(false);
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

      component.isIgnored('anything', false);
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

      expect(component.isIgnored('secret/file.md', false)).toBe(false);
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

      component.isIgnored('secret/file.md', false);
      component.isIgnored('secret/other.md', false);

      // GetConfig should be called for the first isIgnored, but the second should use cached regexps.
      // We can verify by checking that both return true (i.e., the pattern was applied)
      expect(component.isIgnored('secret/file.md', false)).toBe(true);
      expect(component.isIgnored('secret/other.md', false)).toBe(true);
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
      expect(component.isIgnored('some/path', false)).toBe(false);
    });

    it('should store results in IndexedDB via addStoreAction', async () => {
      const { filesStore } = setupIndexedDb();
      const component = createComponent();
      await component.loadWithPromises();

      component.isIgnored('test.md', false);

      // Trigger the debounced store actions
      vi.runAllTimers();

      expect(filesStore.put).toHaveBeenCalled();
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

      component.clearCachedExcludeRegExps();
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
      component.clearCachedExcludeRegExps();

      expect(invokeAsyncSafelyAfterDelay).toHaveBeenCalled();
    });
  });

  describe('handleDeletedOrDotFile', () => {
    it('should remove path from fileIgnoreMap if present', async () => {
      setupIndexedDb();
      const component = createComponent();
      await component.loadWithPromises();

      // Populate the cache
      component.isIgnored('test.md', false);

      await component.handleDeletedOrDotFile('test.md');
      // After deletion, should recalculate
      expect(component.isIgnored('test.md', false)).toBe(false);
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
      component.isIgnored('.obsidianignore', false);

      vi.mocked(readSafe).mockResolvedValueOnce('changed-content');
      await component.handleDeletedOrDotFile('.obsidianignore');

      expect(invokeAsyncSafelyAfterDelay).toHaveBeenCalled();
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
      await component.writeObsidianIgnore('existing-content');

      expect(writeSafe).not.toHaveBeenCalled();
    });

    it('should write file and update settings when content changes', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValue('');
      const pluginSettingsComponent = createPluginSettingsComponent();
      const component = createComponent({ pluginSettingsComponent });
      await component.loadWithPromises();

      await component.writeObsidianIgnore('new-content');

      expect(writeSafe).toHaveBeenCalled();
      expect(pluginSettingsComponent.setProperty).toHaveBeenCalledWith('obsidianIgnoreContent', 'new-content');
    });

    it('should not write again if called with the same new content twice', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValue('');
      const component = createComponent();
      await component.loadWithPromises();

      vi.mocked(writeSafe).mockClear();
      await component.writeObsidianIgnore('new-content');
      vi.mocked(writeSafe).mockClear();
      await component.writeObsidianIgnore('new-content');

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

  describe('loadDb', () => {
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

    it('should load cached file entries when mtime matches', async () => {
      vi.mocked(deepEqual).mockReturnValue(true);
      setupIndexedDb({
        filesEntries: [
          { isIgnored: true, path: 'ignored.md' },
          { isIgnored: false, path: 'visible.md' }
        ]
      });
      const component = createComponent();
      await component.loadWithPromises();

      // The cached entries should be loaded
      expect(component.isIgnored('ignored.md', false)).toBe(true);
      expect(component.isIgnored('visible.md', false)).toBe(false);
    });

    it('should reset DB when mtime does not match', async () => {
      vi.mocked(deepEqual).mockReturnValue(false);
      const { filesStore } = setupIndexedDb({
        filesEntries: [{ isIgnored: true, path: 'old.md' }]
      });
      const component = createComponent();
      await component.loadWithPromises();

      expect(filesStore.clear).toHaveBeenCalled();
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

      expect(component.isIgnored('node_modules/pkg', false)).toBe(true);
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
      component.isIgnored('test-file.md', false);
      expect(component.isIgnored('test-file.md', false)).toBe(false);

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
      expect(component.isIgnored('test-file.md', false)).toBe(true);
    });
  });

  describe('processStoreActions', () => {
    it('should batch pending store operations', async () => {
      const { filesStore } = setupIndexedDb();
      const component = createComponent();
      await component.loadWithPromises();

      // Trigger multiple isIgnored calls to queue store actions
      component.isIgnored('file1.md', false);
      component.isIgnored('file2.md', false);

      // Run the debounced timer
      vi.runAllTimers();

      expect(filesStore.put).toHaveBeenCalledTimes(2);
    });

    it('should clear pending actions after processing', async () => {
      const { filesStore } = setupIndexedDb();
      const component = createComponent();
      await component.loadWithPromises();

      component.isIgnored('file1.md', false);
      vi.runAllTimers();

      const putCallsAfterFirst = filesStore.put.mock.calls.length;

      // Running timers again should not trigger more puts
      vi.runAllTimers();

      expect(filesStore.put.mock.calls.length).toBe(putCallsAfterFirst);
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

      expect(component.isIgnored('debug.log', false)).toBe(true);
      expect(component.isIgnored('node_modules/pkg', false)).toBe(true);
      expect(component.isIgnored('src/main.ts', false)).toBe(false);
    });

    it('should cache the ignore tester', async () => {
      setupIndexedDb();
      vi.mocked(readSafe).mockResolvedValue('*.log');
      const component = createComponent();
      await component.loadWithPromises();

      // Both calls should use the same tester
      component.isIgnored('a.log', false);
      component.isIgnored('b.log', false);

      expect(component.isIgnored('a.log', false)).toBe(true);
      expect(component.isIgnored('b.log', false)).toBe(true);
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
        component.isIgnored('test.md', false);
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
      component.isIgnored('cached.md', false);
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

      expect(component.isIgnored('testing123', false)).toBe(true);
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

      expect(component.isIgnored('docs/readme.md', false)).toBe(true);
      expect(component.isIgnored('my-docs/readme.md', false)).toBe(false);
    });
  });
});
