import type { LayoutReadyComponent } from 'obsidian-dev-utils/obsidian/plugin/components/layout-ready-component';
import type { ReadonlyPluginSettingsState } from 'obsidian-dev-utils/obsidian/plugin/components/plugin-settings-component';

import ignore from 'ignore';
import {
  App,
  debounce
} from 'obsidian';
import { invokeAsyncSafelyAfterDelay } from 'obsidian-dev-utils/async';
import { deepEqual } from 'obsidian-dev-utils/object-utils';
import { AsyncComponentBase } from 'obsidian-dev-utils/obsidian/components/async-component';
import { registerAsyncEvent } from 'obsidian-dev-utils/obsidian/components/async-events-component';
import { ensureMetadataCacheReady } from 'obsidian-dev-utils/obsidian/metadata-cache';
import { escapeRegExp } from 'obsidian-dev-utils/reg-exp';

import type { VaultLoadPatch } from './patches/vault-load-patch.ts';
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

const DB_VERSION = 1;
const MTIME_STORE_NAME = 'mtime';
const FILES_STORE_NAME = 'files';
const PROCESS_STORE_ACTIONS_DEBOUNCE_INTERVAL_IN_MILLISECONDS = 5000;

interface DbFileEntry {
  isIgnored: boolean;
  path: string;
}

interface DbMtimeEntry {
  gitIgnoreMtime: number;
  obsidianIgnoreMtime: number;
  userIgnoreFiltersStr: string;
}

interface IgnorePatternsComponentConstructorParams {
  readonly app: App;
  readonly onUpdateFileTree: () => Promise<void>;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly vaultLoadPatch: VaultLoadPatch;
}

export class IgnorePatternsComponent extends AsyncComponentBase implements LayoutReadyComponent {
  private _db?: IDBDatabase;
  private readonly app: App;
  private cachedExcludeRegExps: null | RegExp[] = null;
  private cachedGitIgnoreContent = '';
  private cachedIgnoreTester: ignore.Ignore | null = null;
  private cachedObsidianIgnoreContent = '';
  private readonly fileIgnoreMap = new Map<string, boolean>();
  private hadConfigChanges = false;
  private readonly onUpdateFileTree: () => Promise<void>;
  private pendingStoreActions: ((store: IDBObjectStore) => void)[] = [];
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly processStoreActionsDebounced = debounce(() => {
    this.processStoreActions();
  }, PROCESS_STORE_ACTIONS_DEBOUNCE_INTERVAL_IN_MILLISECONDS);

  private readonly vaultLoadPatch: VaultLoadPatch;

  private get db(): IDBDatabase {
    if (!this._db) {
      throw new Error('db is not set');
    }
    return this._db;
  }

  public constructor(params: IgnorePatternsComponentConstructorParams) {
    super();
    this.app = params.app;
    this.onUpdateFileTree = params.onUpdateFileTree;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.vaultLoadPatch = params.vaultLoadPatch;
  }

  public clearCachedExcludeRegExps(): void {
    this.cachedExcludeRegExps = null;
    if (this.pluginSettingsComponent.settings.shouldIgnoreExcludedFiles) {
      this.fileIgnoreMap.clear();
      invokeAsyncSafelyAfterDelay(() => this.processConfigChanges());
    }
  }

  public async handleDeletedOrDotFile(normalizedPath: string): Promise<void> {
    if (this.fileIgnoreMap.has(normalizedPath)) {
      this.fileIgnoreMap.delete(normalizedPath);

      this.addStoreAction((store) => store.delete(normalizedPath));
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
      invokeAsyncSafelyAfterDelay(() => this.processConfigChanges());
    }
  }

  public isIgnored(normalizedPath: string, isFolder: boolean): boolean {
    if (normalizedPath === ROOT_PATH) {
      return false;
    }

    let isIgnoredResult = this.fileIgnoreMap.get(normalizedPath);
    if (isIgnoredResult !== undefined) {
      return isIgnoredResult;
    }

    const ignoreTester = this.getIgnoreTester();
    const excludeRegExps = this.getExcludeRegExps();

    const pathsToCheck = isFolder ? [normalizedPath, `${normalizedPath}/`] : [normalizedPath];
    isIgnoredResult = pathsToCheck.some((path) => ignoreTester.ignores(path) || excludeRegExps.some((regExp) => regExp.test(path)));
    this.fileIgnoreMap.set(normalizedPath, isIgnoredResult);
    this.addStoreAction((store) =>
      store.put({
        isIgnored: isIgnoredResult,
        path: normalizedPath
      })
    );

    return isIgnoredResult;
  }

  public async onLayoutReady(): Promise<void> {
    await ensureMetadataCacheReady(this.app);

    this.registerEvent(this.app.vault.on('config-changed', (configKey: string) => {
      if (configKey === 'userIgnoreFilters') {
        this.clearCachedExcludeRegExps();
      }
    }));

    if (!this.vaultLoadPatch.vaultLoadCalled) {
      await this.onUpdateFileTree();
    }
  }

  public override async onload(): Promise<void> {
    await super.onload();
    await this.loadDb();
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
    await this.resetDb();
    await this.onUpdateFileTree();
  }

  public async writeObsidianIgnore(obsidianIgnoreContent: string): Promise<void> {
    if (this.cachedObsidianIgnoreContent === obsidianIgnoreContent) {
      return;
    }

    await writeSafe(this.app, OBSIDIAN_IGNORE_FILE, obsidianIgnoreContent);
    await this.pluginSettingsComponent.setProperty('obsidianIgnoreContent', obsidianIgnoreContent);
    this.cachedObsidianIgnoreContent = obsidianIgnoreContent;
  }

  private addStoreAction(storeAction: (store: IDBObjectStore) => void): void {
    this.pendingStoreActions.push(storeAction);
    this.processStoreActionsDebounced();
  }

  private async getCurrentMtimeEntry(): Promise<DbMtimeEntry> {
    return {
      gitIgnoreMtime: this.pluginSettingsComponent.settings.shouldIncludeGitIgnorePatterns ? (await statSafe(this.app, GIT_IGNORE_FILE))?.mtime ?? 0 : 0,
      obsidianIgnoreMtime: (await statSafe(this.app, OBSIDIAN_IGNORE_FILE))?.mtime ?? 0,
      userIgnoreFiltersStr: this.getUserIgnoreFilters().join('\n')
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
    return this.db.transaction([FILES_STORE_NAME], 'readwrite').objectStore(FILES_STORE_NAME);
  }

  private getIgnoreTester(): ignore.Ignore {
    if (this.cachedIgnoreTester) {
      return this.cachedIgnoreTester;
    }

    const ignorePatternsStr = `${this.cachedObsidianIgnoreContent}\n${this.cachedGitIgnoreContent}`;

    this.cachedIgnoreTester = ignore({
      ignoreCase: true
    }).add(ignorePatternsStr.split('\n'));
    return this.cachedIgnoreTester;
  }

  private getUserIgnoreFilters(): string[] {
    if (!this.pluginSettingsComponent.settings.shouldIgnoreExcludedFiles) {
      return [];
    }

    return (this.app.vault.getConfig('userIgnoreFilters') ?? []) as string[];
  }

  private async loadDb(): Promise<void> {
    const request = window.indexedDB.open(`${this.app.appId}/advanced-exclude`, DB_VERSION);
    request.addEventListener('upgradeneeded', (event) => {
      if (event.newVersion !== 1) {
        return;
      }
      const db = request.result;
      db.createObjectStore(FILES_STORE_NAME, {
        keyPath: 'path'
      });
      db.createObjectStore(MTIME_STORE_NAME);
    });

    const db = await getResult(request);

    this._db = db;
    const transaction = db.transaction([MTIME_STORE_NAME], 'readonly');
    const mtimeStore = transaction.objectStore(MTIME_STORE_NAME);

    const DEFAULT_MTIME_ENTRY: DbMtimeEntry = {
      gitIgnoreMtime: 0,
      obsidianIgnoreMtime: 0,
      userIgnoreFiltersStr: ''
    };

    const mtimeEntry = await getResult(mtimeStore.get(0)) as DbMtimeEntry | undefined ?? DEFAULT_MTIME_ENTRY;
    const currentMtimeEntry = await this.getCurrentMtimeEntry();

    if (!deepEqual(currentMtimeEntry, mtimeEntry)) {
      await this.resetDb();
      return;
    }

    const dbFileEntries = await getResult(this.getFileStore().getAll()) as DbFileEntry[];
    for (const entry of dbFileEntries) {
      this.fileIgnoreMap.set(entry.path, entry.isIgnored);
    }
  }

  private processStoreActions(): void {
    const pendingStoreActions = this.pendingStoreActions;
    this.pendingStoreActions = [];

    const transaction = this.db.transaction(FILES_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(FILES_STORE_NAME);
    for (const action of pendingStoreActions) {
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
    if (obsidianIgnoreContent === undefined) {
      await this.readObsidianIgnore();
    } else {
      await this.writeObsidianIgnore(obsidianIgnoreContent);
    }
    await this.readGitIgnore();
  }

  private async resetDb(): Promise<void> {
    const currentMtimeEntry = await this.getCurrentMtimeEntry();

    const transaction = this.db.transaction([FILES_STORE_NAME, MTIME_STORE_NAME], 'readwrite');
    const mtimeStore = transaction.objectStore(MTIME_STORE_NAME);
    const filesStore = transaction.objectStore(FILES_STORE_NAME);
    filesStore.clear();
    this.fileIgnoreMap.clear();
    mtimeStore.put(currentMtimeEntry, 0);
  }
}

async function getResult<T>(request: IDBRequest<T>): Promise<T> {
  if (request.readyState === 'done') {
    return request.result;
  }

  return await new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      const error: Error = request.error ?? new Error('Unknown error');
      reject(error);
    });
  });
}
