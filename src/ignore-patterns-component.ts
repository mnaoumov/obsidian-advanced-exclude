import type { ReadonlyPluginSettingsState } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';

import ignore from 'ignore';
import {
  App,
  debounce
} from 'obsidian';
import { invokeAsyncSafelyAfterDelay } from 'obsidian-dev-utils/async';
import { isDeepEqual } from 'obsidian-dev-utils/object-utils';
import { registerAsyncEvent } from 'obsidian-dev-utils/obsidian/components/async-events-component';
import { LayoutReadyComponent } from 'obsidian-dev-utils/obsidian/components/layout-ready-component';
import { ensureMetadataCacheReady } from 'obsidian-dev-utils/obsidian/metadata-cache';
import { escapeRegExp } from 'obsidian-dev-utils/reg-exp';

import type { VaultLoadPatchComponent } from './patches/vault-load-patch-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type { PluginSettings } from './plugin-settings.ts';

import {
  GIT_IGNORE_FILE,
  OBSIDIAN_IGNORE_FILE,
  ROOT_PATH
} from './constants.ts';
import {
  readSafe,
  statSafe,
  writeSafe
} from './data-adapter-safe.ts';
import { getResult } from './indexed-database-utils.ts';

const DB_VERSION = 1;
// Bumped whenever the ignore-matching logic changes shape (e.g. the folder verdict
// Now tests the trailing-slash form only). It rides in the mtime entry so an upgrade
// Whose ignore-file modification times are unchanged still fails the `isDeepEqual` check in `loadDb`
// And resets the persisted per-path verdicts instead of serving stale ones.
const IGNORE_MATCHER_VERSION = 2;
const MTIME_STORE_NAME = 'mtime';
const FILES_STORE_NAME = 'files';
const PROCESS_STORE_ACTIONS_DEBOUNCE_INTERVAL_IN_MILLISECONDS = 5000;

interface DatabaseFileEntry {
  isIgnored: boolean;
  path: string;
}

interface DatabaseMtimeEntry {
  gitIgnoreMtime: number;
  matcherVersion: number;
  obsidianIgnoreMtime: number;
  userIgnoreFiltersString: string;
}

const DEFAULT_MTIME_ENTRY: DatabaseMtimeEntry = {
  gitIgnoreMtime: 0,
  matcherVersion: IGNORE_MATCHER_VERSION,
  obsidianIgnoreMtime: 0,
  userIgnoreFiltersString: ''
};

interface IgnorePatternsComponentConstructorParams {
  readonly app: App;
  onUpdateFileTree(this: void): Promise<void>;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly vaultLoadPatch: VaultLoadPatchComponent;
}

interface IgnorePatternsComponentIsIgnoredParams {
  readonly isFolder: boolean;
  readonly normalizedPath: string;
}

export class IgnorePatternsComponent extends LayoutReadyComponent {
  private _database?: IDBDatabase;
  private cachedExcludeRegExps: null | RegExp[] = null;
  private cachedGitIgnoreContent = '';
  private cachedIgnoreTester: ignore.Ignore | null = null;
  private cachedObsidianIgnoreContent = '';
  // Whether the config fingerprint matched the persisted one at load (see
  // `loadFingerprint`/`isConfigUnchanged`) — the gate for the fast-enable path.
  private configFingerprintMatched = false;
  private readonly fileIgnoreMap = new Map<string, boolean>();
  private hadConfigChanges = false;
  private readonly onUpdateFileTree: () => Promise<void>;
  private pendingStoreActions = new Map<string, (store: IDBObjectStore) => void>();
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  private readonly processStoreActionsDebounced = debounce(() => {
    this.processStoreActions();
  }, PROCESS_STORE_ACTIONS_DEBOUNCE_INTERVAL_IN_MILLISECONDS);

  private readonly vaultLoadPatch: VaultLoadPatchComponent;
  // Whether the persisted per-path verdicts have been hydrated into `fileIgnoreMap`
  // (or there is nothing left to hydrate after a reset). Deferred off the enable
  // Path; see `ensureVerdictsLoaded`.
  private verdictsLoaded = false;

  private get database(): IDBDatabase {
    if (!this._database) {
      throw new Error('database is not set');
    }
    return this._database;
  }

  public constructor(params: IgnorePatternsComponentConstructorParams) {
    super(params.app);
    this.onUpdateFileTree = params.onUpdateFileTree;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.vaultLoadPatch = params.vaultLoadPatch;
  }

  /**
   * Loads the persisted per-path verdicts into {@link fileIgnoreMap} on first
   * need — the deferred half of the old `loadDb`. A no-op after the first call or
   * once a fingerprint mismatch has already reset (and thus emptied) the cache.
   * The fast-enable path never calls this; a full recompute calls it first to keep
   * its per-node verdict lookups warm.
   */
  public async ensureVerdictsLoaded(): Promise<void> {
    if (this.verdictsLoaded) {
      return;
    }
    this.verdictsLoaded = true;
    const databaseFileEntries = await getResult(this.getFileStore().getAll()) as DatabaseFileEntry[];
    for (const entry of databaseFileEntries) {
      this.fileIgnoreMap.set(entry.path, entry.isIgnored);
    }
  }

  public async handleDeletedOrDotFile(normalizedPath: string): Promise<void> {
    if (this.fileIgnoreMap.has(normalizedPath)) {
      this.fileIgnoreMap.delete(normalizedPath);

      this.addStoreAction(normalizedPath, (store) => store.delete(normalizedPath));
    }

    let shouldRefresh = false;
    if (normalizedPath === OBSIDIAN_IGNORE_FILE) {
      shouldRefresh ||= await this.readObsidianIgnore();
    }

    if (normalizedPath === GIT_IGNORE_FILE) {
      shouldRefresh ||= await this.readGitIgnore();
    }

    if (shouldRefresh) {
      this.cachedIgnoreTester = null;
      invokeAsyncSafelyAfterDelay({
        asyncFunction: () => this.processConfigChanges()
      });
    }
  }

  /**
   * Whether the ignore-config fingerprint matched the persisted one at load — i.e.
   * `.obsidianignore` / `.gitignore` / `userIgnoreFilters` / the matcher version are
   * unchanged since the hidden set was persisted. The fast-enable path requires this:
   * the persisted hidden set is only trustworthy under an unchanged config.
   */
  public isConfigUnchanged(): boolean {
    return this.configFingerprintMatched;
  }

  public isIgnored(params: IgnorePatternsComponentIsIgnoredParams): boolean {
    const { isFolder, normalizedPath } = params;
    if (normalizedPath === ROOT_PATH) {
      return false;
    }

    let isIgnoredResult = this.fileIgnoreMap.get(normalizedPath);
    if (isIgnoredResult !== undefined) {
      return isIgnoredResult;
    }

    const ignoreTester = this.getIgnoreTester();
    const excludeRegExps = this.getExcludeRegExps();

    // A folder is tested against the trailing-slash (directory) form only: that is the
    // Form gitignore negation re-includes via `!*/`, so a whitelist idiom (`*` + `!*/` +
    // `!*.md`) leaves folders traversable instead of the slash-less `foo` being caught by
    // `*`. Dir-only (`build/`) and plain (`node_modules`) patterns still match the slash
    // Form, so this is stricter only where negation intends it. The exclude regexps
    // (Obsidian's `userIgnoreFilters`) keep testing both forms, unchanged.
    const gitignorePath = isFolder ? `${normalizedPath}/` : normalizedPath;
    const excludePaths = isFolder ? [normalizedPath, `${normalizedPath}/`] : [normalizedPath];
    isIgnoredResult = ignoreTester.ignores(gitignorePath)
      || excludePaths.some((path) => excludeRegExps.some((regExp) => regExp.test(path)));
    this.fileIgnoreMap.set(normalizedPath, isIgnoredResult);
    this.addStoreAction(normalizedPath, (store) =>
      store.put({
        isIgnored: isIgnoredResult,
        path: normalizedPath
      }));

    return isIgnoredResult;
  }

  public override async onloadAsync(): Promise<void> {
    await this.loadFingerprint();
    await this.reload();
    registerAsyncEvent(
      this,
      this.pluginSettingsComponent.on('loadSettings', async (_loadedState, isInitialLoad) => {
        if (!isInitialLoad) {
          await this.readObsidianIgnore();
        }
      })
    );

    registerAsyncEvent(
      this,
      this.pluginSettingsComponent.on('saveSettings', async (newState: ReadonlyPluginSettingsState<PluginSettings>) => {
        await this.reload(newState.effectiveValues.obsidianIgnoreContent);
        this.hadConfigChanges = true;
      })
    );
  }

  public async processConfigChanges(): Promise<void> {
    if (!this.hadConfigChanges) {
      return;
    }
    this.hadConfigChanges = false;
    await this.resetDatabase();
    await this.onUpdateFileTree();
  }

  protected override async onLayoutReady(): Promise<void> {
    await ensureMetadataCacheReady(this.app);

    this.registerEvent(this.app.vault.on('config-changed', (configKey: string) => {
      if (configKey === 'userIgnoreFilters') {
        this.clearCachedExcludeRegExps();
      }
    }));

    if (!this.vaultLoadPatch.wasVaultLoadCalled) {
      await this.onUpdateFileTree();
    }
  }

  private addStoreAction(normalizedPath: string, storeAction: (store: IDBObjectStore) => void): void {
    // Keyed by path so repeated config changes overwrite rather than append: the
    // Queue is bounded to the number of distinct paths instead of growing by the
    // Whole vault on every `processConfigChanges`.
    this.pendingStoreActions.set(normalizedPath, storeAction);
    this.processStoreActionsDebounced();
  }

  private clearCachedExcludeRegExps(): void {
    this.cachedExcludeRegExps = null;
    if (this.pluginSettingsComponent.settings.shouldIgnoreExcludedFiles) {
      this.fileIgnoreMap.clear();
      invokeAsyncSafelyAfterDelay({
        asyncFunction: () => this.processConfigChanges()
      });
    }
  }

  private async getCurrentMtimeEntry(): Promise<DatabaseMtimeEntry> {
    const gitIgnoreStat = this.pluginSettingsComponent.settings.shouldIncludeGitIgnorePatterns ? await statSafe(this.app, GIT_IGNORE_FILE) : null;
    const obsidianIgnoreStat = await statSafe(this.app, OBSIDIAN_IGNORE_FILE);
    return {
      gitIgnoreMtime: gitIgnoreStat?.mtime ?? 0,
      matcherVersion: IGNORE_MATCHER_VERSION,
      obsidianIgnoreMtime: obsidianIgnoreStat?.mtime ?? 0,
      userIgnoreFiltersString: this.getUserIgnoreFilters().join('\n')
    };
  }

  private getExcludeRegExps(): RegExp[] {
    if (!this.pluginSettingsComponent.settings.shouldIgnoreExcludedFiles) {
      return [];
    }

    if (this.cachedExcludeRegExps) {
      return this.cachedExcludeRegExps;
    }

    const filters = this.getUserIgnoreFilters();
    const excludeRegExps = filters.map((filter) => {
      if (filter.length > 1 && filter.startsWith('/') && filter.endsWith('/')) {
        try {
          return new RegExp(filter.slice(1, -1), 'i');
        } catch {
          console.error(`Invalid exclude filter: ${filter}`);
          return null;
        }
      }
      return new RegExp(`^${escapeRegExp(filter)}`, 'i');
    }).filter((regExp) => !!regExp);
    this.cachedExcludeRegExps = excludeRegExps;
    return excludeRegExps;
  }

  private getFileStore(): IDBObjectStore {
    return this.database.transaction([FILES_STORE_NAME], 'readwrite').objectStore(FILES_STORE_NAME);
  }

  private getIgnoreTester(): ignore.Ignore {
    if (this.cachedIgnoreTester) {
      return this.cachedIgnoreTester;
    }

    const ignorePatternsString = `${this.cachedObsidianIgnoreContent}\n${this.cachedGitIgnoreContent}`;

    this.cachedIgnoreTester = ignore({
      ignoreCase: true
    }).add(ignorePatternsString.split('\n'));
    return this.cachedIgnoreTester;
  }

  private getUserIgnoreFilters(): string[] {
    if (!this.pluginSettingsComponent.settings.shouldIgnoreExcludedFiles) {
      return [];
    }

    return (this.app.vault.getConfig('userIgnoreFilters') ?? []) as string[];
  }

  /**
   * Opens the verdict DB and validates the config fingerprint, but does **not**
   * eagerly load the (up to ~90k) cached per-path verdicts — that `getAll` was the
   * dominant enable cost and is deferred to {@link ensureVerdictsLoaded}, run only
   * when a full recompute actually needs a warm cache. On a fingerprint mismatch the
   * stale cache is reset here (nothing then remains to load).
   */
  private async loadFingerprint(): Promise<void> {
    const request = window.indexedDB.open(`${this.app.appId}/advanced-exclude`, DB_VERSION);
    request.addEventListener('upgradeneeded', (event) => {
      if (event.newVersion !== 1) {
        return;
      }
      const database = request.result;
      database.createObjectStore(FILES_STORE_NAME, {
        keyPath: 'path'
      });
      database.createObjectStore(MTIME_STORE_NAME);
    });

    const database = await getResult(request);

    this._database = database;
    const transaction = database.transaction([MTIME_STORE_NAME], 'readonly');
    const mtimeStore = transaction.objectStore(MTIME_STORE_NAME);

    const mtimeEntry = await getResult(mtimeStore.get(0)) as DatabaseMtimeEntry | undefined ?? DEFAULT_MTIME_ENTRY;
    const currentMtimeEntry = await this.getCurrentMtimeEntry();

    if (!isDeepEqual(currentMtimeEntry, mtimeEntry)) {
      // Config changed: drop the stale verdicts now (this also marks the cache
      // "Loaded" — empty — so `ensureVerdictsLoaded` becomes a no-op).
      await this.resetDatabase();
      this.configFingerprintMatched = false;
      return;
    }

    this.configFingerprintMatched = true;
  }

  private processStoreActions(): void {
    const pendingStoreActions = this.pendingStoreActions;
    this.pendingStoreActions = new Map();

    const transaction = this.database.transaction(FILES_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(FILES_STORE_NAME);
    for (const action of pendingStoreActions.values()) {
      action(store);
    }
    transaction.commit();
  }

  private async readGitIgnore(): Promise<boolean> {
    if (!this.pluginSettingsComponent.settings.shouldIncludeGitIgnorePatterns) {
      this.cachedGitIgnoreContent = '';
      return false;
    }

    const gitIgnoreContent = await readSafe(this.app, GIT_IGNORE_FILE);
    if (gitIgnoreContent === this.cachedGitIgnoreContent) {
      return false;
    }

    this.cachedGitIgnoreContent = gitIgnoreContent;
    return true;
  }

  private async readObsidianIgnore(): Promise<boolean> {
    const obsidianIgnoreContent = await readSafe(this.app, OBSIDIAN_IGNORE_FILE);
    if (obsidianIgnoreContent === this.cachedObsidianIgnoreContent) {
      return false;
    }

    await this.pluginSettingsComponent.setProperty('obsidianIgnoreContent', obsidianIgnoreContent);
    this.cachedObsidianIgnoreContent = obsidianIgnoreContent;
    return true;
  }

  private async reload(obsidianIgnoreContent?: string): Promise<void> {
    this.cachedIgnoreTester = null;
    let hasPatternChanges: boolean;
    if (obsidianIgnoreContent === undefined) {
      hasPatternChanges = await this.readObsidianIgnore();
    } else {
      hasPatternChanges = this.cachedObsidianIgnoreContent !== obsidianIgnoreContent;
      await this.writeObsidianIgnore(obsidianIgnoreContent);
    }

    const hasGitIgnoreChanges = await this.readGitIgnore();
    if (hasPatternChanges || hasGitIgnoreChanges) {
      this.fileIgnoreMap.clear();
    }
  }

  private async resetDatabase(): Promise<void> {
    const currentMtimeEntry = await this.getCurrentMtimeEntry();

    const transaction = this.database.transaction([FILES_STORE_NAME, MTIME_STORE_NAME], 'readwrite');
    const mtimeStore = transaction.objectStore(MTIME_STORE_NAME);
    const filesStore = transaction.objectStore(FILES_STORE_NAME);
    filesStore.clear();
    this.fileIgnoreMap.clear();
    // Drop any queued writes: they target the store we just cleared and would
    // Otherwise repopulate it with stale entries.
    this.pendingStoreActions.clear();
    // The store is now empty, so there is nothing left for `ensureVerdictsLoaded`
    // To hydrate — `fileIgnoreMap` (empty) is authoritative and repopulates on miss.
    this.verdictsLoaded = true;
    mtimeStore.put(currentMtimeEntry, 0);
  }

  private async writeObsidianIgnore(obsidianIgnoreContent: string): Promise<void> {
    if (this.cachedObsidianIgnoreContent === obsidianIgnoreContent) {
      return;
    }

    await writeSafe({ app: this.app, content: obsidianIgnoreContent, path: OBSIDIAN_IGNORE_FILE });
    await this.pluginSettingsComponent.setProperty('obsidianIgnoreContent', obsidianIgnoreContent);
    this.cachedObsidianIgnoreContent = obsidianIgnoreContent;
  }
}
