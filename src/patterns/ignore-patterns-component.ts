import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';

import { registerAsyncEvent } from '@mnaoumov/obsidian-lib/components/async-events-component';
import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import { PluginNoticeMode } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import { ensureMetadataCacheReady } from '@mnaoumov/obsidian-lib/metadata-cache';
import {
  invokeAsyncSafely,
  invokeAsyncSafelyAfterDelay
} from '@mnaoumov/typescript-lib/async';
import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { isDeepEqual } from '@mnaoumov/typescript-lib/object-utils';
import { escapeRegExp } from '@mnaoumov/typescript-lib/reg-exp';
import ignore from 'ignore';
import {
  App,
  debounce,
  Platform
} from 'obsidian';

import type { LocalRecordStore } from '../local-record-store.ts';
import type { ImportedFileContents } from '../profiles/profiles.ts';
import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

import {
  GIT_IGNORE_FILE,
  OBSIDIAN_IGNORE_FILE,
  ROOT_PATH
} from '../constants.ts';
import {
  readIfExists,
  readSafe,
  statSafe,
  writeSafe
} from '../data-adapter-safe.ts';
import {
  formatLocalPatternsFile,
  LOCAL_PATTERNS_HEADER,
  normalizeLocalPatterns
} from './local-patterns.ts';
import { appendFindingMessage } from './pattern-findings-view.ts';
import {
  PatternFindingSeverity,
  validatePatterns
} from './pattern-validation.ts';
import {
  checkDatabaseFileEntry,
  createVerdictRecordStore
} from './verdict-record-store.ts';

// Bumped whenever the ignore-matching logic changes shape (e.g. the folder verdict
// now tests the trailing-slash form only). It rides in the mtime entry so an upgrade
// whose ignore-file modification times are unchanged still fails the `isDeepEqual` check in `loadDb`
// and resets the persisted per-path verdicts instead of serving stale ones.
const IGNORE_MATCHER_VERSION = 2;

const PROCESS_STORE_ACTIONS_DEBOUNCE_INTERVAL_IN_MILLISECONDS = 5000;
const SAVE_LOCAL_PATTERNS_DEBOUNCE_INTERVAL_IN_MILLISECONDS = 500;
/**
 * How many queued verdict writes one flush transaction takes before yielding. A pattern change
 * re-verdicts the whole vault, and writing ~91k verdicts in one task froze the window for ~1 s at
 * a 91k-node real vault's scale.
 */
const STORE_ACTIONS_CHUNK_SIZE = 2000;

interface DatabaseMtimeEntry {
  readonly gitIgnoreMtime: number;
  readonly matcherVersion: number;
  readonly obsidianIgnoreMtime: number;
  /**
   * The effective patterns and scalars: the base settings', or the active profile's expansion.
   */
  readonly settingsFingerprint: string;
  readonly userIgnoreFiltersString: string;
}

const DEFAULT_MTIME_ENTRY: DatabaseMtimeEntry = {
  gitIgnoreMtime: 0,
  matcherVersion: IGNORE_MATCHER_VERSION,
  obsidianIgnoreMtime: 0,
  settingsFingerprint: '',
  userIgnoreFiltersString: ''
};

/**
 * The `app.loadLocalStorage` key of the `@import file:` paths already reported missing on this device, so a missing
 * file is reported once, not on every app start, until it exists again or is no longer imported.
 */
export const REPORTED_MISSING_IMPORTS_LOCAL_STORAGE_KEY = 'advanced-exclude:reported-missing-imports';

interface IgnorePatternsComponentConstructorParams {
  readonly app: App;
  readonly isSettingsTabOpen: (this: void) => boolean;
  readonly onUpdateFileTree: (this: void) => Promise<void>;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface IgnorePatternsComponentIsIgnoredParams {
  readonly isFolder: boolean;
  readonly normalizedPath: string;
}

interface ObsidianIgnoreReadResult {
  readonly hasPatternChanges: boolean;
  /**
   * Whether the file's raw content or existence changed, which can leave its patterns as they were.
   */
  readonly isFileChanged: boolean;
}

export class IgnorePatternsComponent extends LayoutReadyComponent {
  // Initialized so onunload can test it before a load ever opened it.
  private _database: LocalRecordStore | undefined = undefined;
  private appliedFingerprint: DatabaseMtimeEntry = DEFAULT_MTIME_ENTRY;
  // The settings fingerprint the verdict store was last reset under; see the `loadSettings` handler.
  private appliedSettingsFingerprint: null | string = null;
  private cachedEffectivePatterns = '';
  private cachedExcludeRegExps: null | RegExp[] = null;
  private cachedGitIgnoreContent = '';
  private cachedIgnoreTester: ignore.Ignore | null = null;
  // The patterns of `.obsidianignore`, normalized: no byte order mark, LF line endings, `''` for a missing file.
  private cachedLocalPatterns = '';
  // Whether the config fingerprint matched the persisted one at load (see
  // `loadFingerprint`/`isConfigUnchanged`) — the gate for the fast-enable path.
  private configFingerprintMatched = false;
  private readonly fileIgnoreMap = new Map<string, boolean>();
  private flushPromise: null | Promise<void> = null;
  private hadConfigChanges = false;
  // Whether `.obsidianignore` has been read once: the first read is the plugin loading, not an edit to report.
  private isLocalPatternsFileRead = false;
  // A `saveSettings` made while the settings tab was open left its reload to `processConfigChanges`.
  private isReloadPending = false;
  private readonly isSettingsTabOpen: () => boolean;
  private isStoreReleased = false;
  // The errors of `.obsidianignore` last reported (or seen at load), so each change is reported once.
  private localPatternErrorsKey = '[]';
  private readonly localPatternsChangeListeners = new Set<() => void>();
  // The raw content of `.obsidianignore` as last read or written, or `null` when it does not exist: a save keeps
  // its line ending and byte order mark.
  private localPatternsFileContent: null | string = null;
  // The last save of `.obsidianignore`. A read waits for it, so it never takes a half-saved file for an outside edit.
  private localPatternsWrite: Promise<void> = noopAsync();
  private readonly onUpdateFileTree: () => Promise<void>;
  // The text of `.obsidianignore` the settings tab is waiting to save, or `null` when nothing waits.
  private pendingLocalPatternsText: null | string = null;
  private readonly pendingStoreActions = new Map<string, boolean | undefined>();
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  private readonly processStoreActionsDebounced = debounce(() => {
    invokeAsyncSafely(() => this.processStoreActions());
  }, PROCESS_STORE_ACTIONS_DEBOUNCE_INTERVAL_IN_MILLISECONDS);

  private readonly saveLocalPatternsDebounced = debounce(
    () => {
      invokeAsyncSafely(() => this.flushLocalPatterns());
    },
    SAVE_LOCAL_PATTERNS_DEBOUNCE_INTERVAL_IN_MILLISECONDS,
    true
  );

  // Bumped whenever queued verdicts stop being valid (a store reset, an unload), so a chunked
  // flush still running from before stops instead of writing stale verdicts into the fresh store.
  private storeGeneration = 0;

  // Whether the persisted per-path verdicts have been hydrated into `fileIgnoreMap`
  // (or there is nothing left to hydrate after a reset). Deferred off the enable
  // path; see `ensureVerdictsLoaded`.
  private verdictsLoaded = false;

  private get database(): LocalRecordStore {
    if (!this._database) {
      throw new Error('database is not set');
    }
    return this._database;
  }

  public constructor(params: IgnorePatternsComponentConstructorParams) {
    super(params.app);
    this.isSettingsTabOpen = params.isSettingsTabOpen;
    this.onUpdateFileTree = params.onUpdateFileTree;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  /**
   * Loads the persisted per-path verdicts into {@link fileIgnoreMap} on first
   * need — the deferred half of the old `loadDb`. A no-op after the first call or
   * once a fingerprint mismatch has already reset (and thus emptied) the cache.
   * The fast-enable path never calls this; a full recompute calls it first to keep
   * its per-node verdict lookups warm.
   */
  /**
   * Re-applies the ignore state after the effective settings changed under the running plugin (another profile became
   * active, or a synced `data.json` arrived), so this runs the same path as an edit in the settings tab.
   */
  public async applySettingsChange(): Promise<void> {
    this.cachedIgnoreTester = null;
    this.cachedExcludeRegExps = null;
    await this.reload();
    this.fileIgnoreMap.clear();
    this.hadConfigChanges = true;
    await this.processConfigChanges();
  }

  public async ensureVerdictsLoaded(): Promise<void> {
    if (this.verdictsLoaded) {
      return;
    }
    this.verdictsLoaded = true;
    const generation = this.storeGeneration;
    const records = await this.database.entries();
    if (generation !== this.storeGeneration) {
      return;
    }
    const databaseFileEntries = records.filter(([key]) => key.startsWith('path:')).map(([, value]) => value).filter(checkDatabaseFileEntry);
    for (const entry of databaseFileEntries) {
      this.fileIgnoreMap.set(entry.path, entry.isIgnored);
    }
  }

  /**
   * Saves the text {@link scheduleLocalPatternsSave} is waiting to save, now.
   */
  public async flushLocalPatterns(): Promise<void> {
    this.saveLocalPatternsDebounced.cancel();
    const text = this.pendingLocalPatternsText;
    if (text === null) {
      return;
    }
    this.pendingLocalPatternsText = null;
    await this.saveLocalPatterns(text);
  }

  /**
   * The text the settings tab edits for `.obsidianignore`: the whole file, comments included, with LF line endings; or
   * {@link LOCAL_PATTERNS_HEADER} while the file does not exist, which the first save writes. A text still waiting to be
   * saved wins, so a re-render of the tab keeps what was typed.
   */
  public getLocalPatternsText(): string {
    if (this.pendingLocalPatternsText !== null) {
      return this.pendingLocalPatternsText;
    }
    return this.localPatternsFileContent === null ? LOCAL_PATTERNS_HEADER : this.cachedLocalPatterns;
  }

  public async handleDeletedOrDotFile(normalizedPath: string): Promise<void> {
    if (this.fileIgnoreMap.has(normalizedPath)) {
      this.fileIgnoreMap.delete(normalizedPath);

      this.addStoreAction(normalizedPath, undefined);
    }

    let shouldRefresh = false;
    if (normalizedPath === OBSIDIAN_IGNORE_FILE) {
      const { hasPatternChanges, isFileChanged } = await this.readObsidianIgnore();
      shouldRefresh = hasPatternChanges;
      // Also when only the file's existence or line endings changed: the tab shows the header for a missing file.
      if (isFileChanged) {
        for (const listener of this.localPatternsChangeListeners) {
          listener();
        }
      }
    }

    if (normalizedPath === GIT_IGNORE_FILE) {
      shouldRefresh ||= await this.readGitIgnore();
    }

    if (!shouldRefresh) {
      return;
    }

    this.cachedIgnoreTester = null;
    // Reading an ignore file fires no `saveSettings`, so nothing else raises the flag: without it `processConfigChanges` returns at once, and an ignore file edited while the
    // plugin runs is not applied until the next restart.
    this.hadConfigChanges = true;
    invokeAsyncSafelyAfterDelay({
      asyncFunction: () => this.processConfigChanges()
    });
  }

  /**
   * Whether the ignore-config fingerprint matched the persisted one at load — i.e.
   * the patterns and settings / `.obsidianignore` / `.gitignore` / `userIgnoreFilters` / the matcher version are
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
    // form gitignore negation re-includes via `!*/`, so a whitelist idiom (`*` + `!*/` +
    // `!*.md`) leaves folders traversable instead of the slash-less `foo` being caught by
    // `*`. Dir-only (`build/`) and plain (`node_modules`) patterns still match the slash
    // form, so this is stricter only where negation intends it. The exclude regexps
    // (Obsidian's `userIgnoreFilters`) keep testing both forms, unchanged.
    const gitignorePath = isFolder ? `${normalizedPath}/` : normalizedPath;
    const excludePaths = isFolder ? [normalizedPath, `${normalizedPath}/`] : [normalizedPath];
    isIgnoredResult = ignoreTester.ignores(gitignorePath)
      || excludePaths.some((path) => excludeRegExps.some((regExp) => regExp.test(path)));
    this.fileIgnoreMap.set(normalizedPath, isIgnoredResult);
    this.addStoreAction(normalizedPath, isIgnoredResult);

    return isIgnoredResult;
  }

  public override async onloadAsync(): Promise<void> {
    // A window reload unloads no plugin, so without this the old document's connection stays open
    // until that dead context is collected, and blocks the new document's `deleteDatabase`.
    this.registerDomEvent(window, 'pagehide', () => {
      this.releaseDatabase();
    });
    // A dot file raises no vault event, and only the desktop watcher reports it at all (as a `reconcileDeletion`), so
    // an edit made in another app, or by a sync tool, is read when the user comes back to Obsidian.
    this.registerDomEvent(window, 'focus', () => {
      invokeAsyncSafely(() => this.refreshLocalPatterns());
    });
    this.registerDomEvent(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        invokeAsyncSafely(() => this.refreshLocalPatterns());
      }
    });
    // Before the fingerprint: the imported files' contents are part of the expanded patterns it covers.
    await this.readImportedFiles();
    await this.loadFingerprint();
    await this.reload();
    registerAsyncEvent(
      this,
      this.pluginSettingsComponent.on('loadSettings', async (_loadedState, isInitialLoad) => {
        if (isInitialLoad) {
          return;
        }
        // A synced `data.json` can change the patterns or settings under a running plugin.
        if (this.getSettingsFingerprint() !== this.appliedSettingsFingerprint) {
          await this.applySettingsChange();
        }
      })
    );

    this.register(this.pluginSettingsComponent.onActiveProfileChange(() => this.applySettingsChange()));

    // `raw` is the one event every change on disk raises, a dot file's and a file this plugin hides included, so it
    // is the watcher for whatever file the active profile imports.
    this.registerEvent(this.app.vault.on('raw', (path: string) => {
      invokeAsyncSafelyAfterDelay({
        asyncFunction: () => this.handleImportedFileChange(path)
      });
    }));

    registerAsyncEvent(
      this,
      this.pluginSettingsComponent.on('saveSettings', async () => {
        this.hadConfigChanges = true;
        // While the settings tab is open it applies on its hide or Apply, so typing a pattern never re-applies per
        // keystroke, and the reload waits too: it would rebuild the tester, and a file created meanwhile would be
        // judged by half-typed patterns. A save made anywhere else (a command, another plugin, the demo vault's
        // buttons) has nothing that would apply it later, so it applies now.
        if (this.isSettingsTabOpen()) {
          this.isReloadPending = true;
          return;
        }
        await this.reload();
        await this.processConfigChanges();
      })
    );
  }

  /**
   * Registers a listener for a change of `.obsidianignore` made outside the settings tab.
   *
   * @returns A function that removes the listener.
   */
  public onLocalPatternsChange(listener: () => void): () => void {
    this.localPatternsChangeListeners.add(listener);
    return () => {
      this.localPatternsChangeListeners.delete(listener);
    };
  }

  /**
   * Releases the connection. An open connection blocks every later `deleteDatabase` and version
   * upgrade, and each enable opened a new one, so a disable must let it go.
   *
   * Accepted verdict writes drain in bounded asynchronous transactions before close.
   */
  public override onunload(): void {
    // The settings tab's hide saves a waiting text; an unload while it still waits only writes it, as nothing is left
    // to apply it.
    this.saveLocalPatternsDebounced.cancel();
    const pendingText = this.pendingLocalPatternsText;
    if (pendingText !== null) {
      this.pendingLocalPatternsText = null;
      invokeAsyncSafely(() => this.writeLocalPatterns(pendingText));
    }
    this.releaseDatabase();
    super.onunload();
  }

  public async processConfigChanges(): Promise<void> {
    await this.flushLocalPatterns();
    if (!this.hadConfigChanges) {
      return;
    }
    this.hadConfigChanges = false;
    if (this.isReloadPending) {
      this.isReloadPending = false;
      await this.reload();
    }
    // An edit made while the settings tab was open left the tester on the patterns applied before it.
    this.rebuildIgnoreTester();
    await this.resetDatabase();
    await this.onUpdateFileTree();
  }

  /**
   * Re-reads `.obsidianignore`, and applies it and tells the listeners when it changed. For a moment no change event
   * covers: the user coming back to Obsidian, or the settings tab rendering.
   */
  public async refreshLocalPatterns(): Promise<void> {
    await this.handleDeletedOrDotFile(OBSIDIAN_IGNORE_FILE);
  }

  /**
   * Writes {@link text} to `.obsidianignore`, keeping the line ending and byte order mark the file already has. Like an
   * edit of the global patterns, it applies on the settings tab's hide or Apply while the tab is open, and at once
   * otherwise. Until it applies, files are still judged by the patterns applied before it.
   */
  public async saveLocalPatterns(text: string): Promise<void> {
    await this.writeLocalPatterns(text);
    this.hadConfigChanges = true;
    if (!this.isSettingsTabOpen()) {
      await this.processConfigChanges();
    }
  }

  /**
   * Saves {@link text} with {@link saveLocalPatterns} once the typing pauses, so a burst of keystrokes writes the file
   * once. {@link processConfigChanges}, which the settings tab's hide and Apply call, saves a waiting text first.
   */
  public scheduleLocalPatternsSave(text: string): void {
    this.pendingLocalPatternsText = text;
    this.saveLocalPatternsDebounced();
  }

  protected override async onLayoutReady(): Promise<void> {
    await ensureMetadataCacheReady(this.app);

    this.registerEvent(this.app.vault.on('config-changed', (configKey: string) => {
      if (configKey === 'userIgnoreFilters') {
        this.clearCachedExcludeRegExps();
      }
    }));
    // The re-projection a layout-ready enable needs is `IndexProjectionComponent.onLayoutReady`'s
    // alone: a second trigger here raced it on every mid-session enable (see `rebuildModel`).
  }

  private addStoreAction(normalizedPath: string, storeAction: boolean | undefined): void {
    if (this.isStoreReleased) {
      return;
    }
    // Keyed by path so repeated config changes overwrite rather than append: the
    // queue is bounded to the number of distinct paths instead of growing by the
    // whole vault on every `processConfigChanges`.
    this.pendingStoreActions.set(normalizedPath, storeAction);
    this.processStoreActionsDebounced();
  }

  /**
   * Notes the errors of `.obsidianignore` and, when {@link shouldReport} and they changed to some, reports the first
   * one. Warnings are left to the settings tab.
   */
  private checkLocalPatternErrors(shouldReport: boolean): void {
    const errors = validatePatterns({ areDirectivesAllowed: false, text: this.cachedLocalPatterns })
      .filter((finding) => finding.severity === PatternFindingSeverity.Error);
    const errorsKey = JSON.stringify(errors);
    if (errorsKey === this.localPatternErrorsKey) {
      return;
    }
    this.localPatternErrorsKey = errorsKey;
    const [firstError] = errors;
    if (!shouldReport || !firstError) {
      return;
    }

    const moreErrors = errors.length > 1 ? ` (and ${String(errors.length - 1)} more)` : '';
    const message = `\`${OBSIDIAN_IGNORE_FILE}\`, line ${String(firstError.lineNumber)}: ${firstError.message}${moreErrors}`;
    console.warn(message);
    // Separate: the edit is applied at once, and the apply's progress notice would otherwise take this one's place.
    this.pluginNoticeComponent.showNotice(
      createFragment((f) => {
        appendFindingMessage(f, message);
      }),
      { mode: PluginNoticeMode.Separate }
    );
  }

  private clearCachedExcludeRegExps(): void {
    this.cachedExcludeRegExps = null;
    if (!this.pluginSettingsComponent.effectiveSettings.shouldIgnoreExcludedFiles) {
      return;
    }

    this.fileIgnoreMap.clear();
    invokeAsyncSafelyAfterDelay({
      asyncFunction: () => this.processConfigChanges()
    });
  }

  private async flushStoreActions(): Promise<void> {
    const generation = this.storeGeneration;
    const expectedFingerprint = JSON.stringify(this.appliedFingerprint);
    while (this._database && this.pendingStoreActions.size > 0 && generation === this.storeGeneration) {
      const chunk = [...this.pendingStoreActions].slice(0, STORE_ACTIONS_CHUNK_SIZE);
      await this._database.commit({
        entries: chunk.filter(([, value]) => value !== undefined).map(([path, isIgnored]) => [`path:${path}`, { isIgnored, path }]),
        expectedFingerprint,
        removedKeys: chunk.filter(([, value]) => value === undefined).map(([path]) => `path:${path}`)
      });
      if (generation !== this.storeGeneration) {
        return;
      }
      for (const [path, value] of chunk) {
        if (this.pendingStoreActions.get(path) === value) {
          this.pendingStoreActions.delete(path);
        }
      }
      if (this.pendingStoreActions.size > 0) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 0);
        });
      }
    }
  }

  private async getCurrentMtimeEntry(): Promise<DatabaseMtimeEntry> {
    const gitIgnoreStat = this.pluginSettingsComponent.effectiveSettings.shouldIncludeGitIgnorePatterns ? await statSafe(this.app, GIT_IGNORE_FILE) : null;
    const obsidianIgnoreStat = await statSafe(this.app, OBSIDIAN_IGNORE_FILE);
    return {
      gitIgnoreMtime: gitIgnoreStat?.mtime ?? 0,
      matcherVersion: IGNORE_MATCHER_VERSION,
      obsidianIgnoreMtime: obsidianIgnoreStat?.mtime ?? 0,
      settingsFingerprint: this.getSettingsFingerprint(),
      userIgnoreFiltersString: this.getUserIgnoreFilters().join('\n')
    };
  }

  /**
   * The pattern text of the settings: the expanded profile while one is active, else the base patterns.
   */
  private getEffectivePatterns(): string {
    return this.pluginSettingsComponent.effectiveSettings.ignorePatterns;
  }

  private getExcludeRegExps(): RegExp[] {
    if (!this.pluginSettingsComponent.effectiveSettings.shouldIgnoreExcludedFiles) {
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

  private getIgnoreTester(): ignore.Ignore {
    return this.cachedIgnoreTester ?? this.rebuildIgnoreTester();
  }

  private getSettingsFingerprint(): string {
    const effectiveSettings = this.pluginSettingsComponent.effectiveSettings;
    return JSON.stringify([
      effectiveSettings.ignorePatterns,
      effectiveSettings.excludeMode,
      effectiveSettings.shouldHideEmptyFolders,
      effectiveSettings.shouldIgnoreExcludedFiles,
      effectiveSettings.shouldIncludeGitIgnorePatterns
    ]);
  }

  private getUserIgnoreFilters(): string[] {
    return this.pluginSettingsComponent.effectiveSettings.shouldIgnoreExcludedFiles ? (this.app.vault.getConfig('userIgnoreFilters') ?? []) : [];
  }

  /**
   * Re-applies the ignore state when {@link path} is a file the active profile imports and its content changed.
   */
  private async handleImportedFileChange(path: string): Promise<void> {
    if (!this.pluginSettingsComponent.effectiveSettings.importedFilePaths.includes(path) || !await this.readImportedFiles()) {
      return;
    }
    this.cachedIgnoreTester = null;
    this.hadConfigChanges = true;
    await this.processConfigChanges();
  }

  /**
   * Opens the verdict DB and validates the config fingerprint, but does **not**
   * eagerly load the (up to ~90k) cached per-path verdicts — that `getAll` was the
   * dominant enable cost and is deferred to {@link ensureVerdictsLoaded}, run only
   * when a full recompute actually needs a warm cache. On a fingerprint mismatch the
   * stale cache is reset here (nothing then remains to load).
   */
  private async loadFingerprint(): Promise<void> {
    const store = createVerdictRecordStore(this.app.appId);
    this._database = store;
    const mtimeEntry = await store.get('fingerprint') ?? DEFAULT_MTIME_ENTRY;
    if (this.isUnloaded()) {
      await store.close();
      return;
    }
    const currentMtimeEntry = await this.getCurrentMtimeEntry();
    this.appliedFingerprint = currentMtimeEntry;
    this.appliedSettingsFingerprint = currentMtimeEntry.settingsFingerprint;

    if (!isDeepEqual(currentMtimeEntry, mtimeEntry)) {
      // Config changed: drop the stale verdicts now (this also marks the cache
      // "Loaded" — empty — so `ensureVerdictsLoaded` becomes a no-op).
      await this.resetDatabase();
      this.configFingerprintMatched = false;
      return;
    }

    this.configFingerprintMatched = true;
  }

  private async processStoreActions(): Promise<void> {
    if (this.flushPromise) {
      await this.flushPromise;
      return;
    }
    this.flushPromise = this.flushStoreActions();
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  private async readGitIgnore(): Promise<boolean> {
    if (!this.pluginSettingsComponent.effectiveSettings.shouldIncludeGitIgnorePatterns) {
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

  /**
   * Reads every file the active profile imports with `@import file:` into the settings component, so the effective
   * patterns expand them.
   *
   * @returns Whether any content changed.
   */
  private async readImportedFiles(): Promise<boolean> {
    const contents = new Map<string, null | string>();
    for (const path of this.pluginSettingsComponent.effectiveSettings.importedFilePaths) {
      contents.set(path, await readIfExists(this.app, path));
    }
    this.reportMissingImports(contents);
    if (isSameImportedFileContents(this.pluginSettingsComponent.importedFileContents, contents)) {
      return false;
    }
    this.pluginSettingsComponent.setImportedFileContents(contents);
    return true;
  }

  /**
   * Reads `.obsidianignore` once a save in flight has finished.
   *
   * @returns What changed since it was last read or written.
   */
  private async readObsidianIgnore(): Promise<ObsidianIgnoreReadResult> {
    await this.localPatternsWrite;
    const content = await readIfExists(this.app, OBSIDIAN_IGNORE_FILE);
    const isEdit = this.isLocalPatternsFileRead;
    this.isLocalPatternsFileRead = true;
    if (content === this.localPatternsFileContent) {
      return { hasPatternChanges: false, isFileChanged: false };
    }

    this.localPatternsFileContent = content;
    const localPatterns = normalizeLocalPatterns(content ?? '');
    const hasPatternChanges = localPatterns !== this.cachedLocalPatterns;
    this.cachedLocalPatterns = localPatterns;
    this.checkLocalPatternErrors(isEdit);
    return { hasPatternChanges, isFileChanged: true };
  }

  /**
   * Builds the tester from the patterns as they are now. Built eagerly wherever patterns apply, so an edit in the
   * settings tab, which changes the patterns without applying them, never reaches it.
   */
  private rebuildIgnoreTester(): ignore.Ignore {
    const ignorePatternsString = `${this.getEffectivePatterns()}\n${this.cachedLocalPatterns}\n${this.cachedGitIgnoreContent}`;

    this.cachedIgnoreTester = ignore({
      ignoreCase: true
    }).add(ignorePatternsString.split('\n'));
    return this.cachedIgnoreTester;
  }

  private releaseDatabase(): void {
    if (this.isStoreReleased) {
      return;
    }
    this.isStoreReleased = true;
    this.processStoreActionsDebounced.cancel();
    invokeAsyncSafely(async () => {
      try {
        await this.processStoreActions();
      } finally {
        await this._database?.close();
        this._database = undefined;
      }
    });
  }

  private async reload(): Promise<void> {
    this.cachedIgnoreTester = null;
    // Before the patterns: the imported files' contents are part of the expansion.
    const hasImportChanges = await this.readImportedFiles();
    const effectivePatterns = this.getEffectivePatterns();
    const hasPatternChanges = effectivePatterns !== this.cachedEffectivePatterns;
    this.cachedEffectivePatterns = effectivePatterns;
    const { hasPatternChanges: hasObsidianIgnoreChanges } = await this.readObsidianIgnore();
    const hasGitIgnoreChanges = await this.readGitIgnore();
    if (hasPatternChanges || hasImportChanges || hasObsidianIgnoreChanges || hasGitIgnoreChanges) {
      this.fileIgnoreMap.clear();
    }
    this.rebuildIgnoreTester();
  }

  /**
   * Reports the paths the active profile imports with `@import file:` that do not exist and were not reported on this
   * device yet. A missing file imports nothing, which is valid, but the path may be mistyped.
   */
  private reportMissingImports(contents: ImportedFileContents): void {
    const storedPaths: unknown = this.app.loadLocalStorage(REPORTED_MISSING_IMPORTS_LOCAL_STORAGE_KEY);
    const reportedPaths = new Set(Array.isArray(storedPaths) ? storedPaths.filter((path) => typeof path === 'string') : []);
    const missingPaths = [...contents].filter(([, content]) => content === null).map(([path]) => path);
    const newPaths = missingPaths.filter((path) => !reportedPaths.has(path));
    if (missingPaths.length !== reportedPaths.size || newPaths.length > 0) {
      // Keeping only the paths missing now forgets one that exists again or is no longer imported.
      this.app.saveLocalStorage(REPORTED_MISSING_IMPORTS_LOCAL_STORAGE_KEY, missingPaths);
    }
    if (newPaths.length === 0) {
      return;
    }

    const messages = [...this.pluginSettingsComponent.effectiveSettings.importingProfileNames]
      .filter(([path]) => newPaths.includes(path))
      .map(([path, profileName]) => `The profile \`${profileName}\` imports \`${path}\` with \`@import file:\`, but the file does not exist, so it imports nothing.`);
    for (const message of messages) {
      console.warn(message);
    }
    // Separate, for the same reason as `checkLocalPatternErrors`: an apply may follow the read.
    this.pluginNoticeComponent.showNotice(
      createFragment((f) => {
        for (const message of messages) {
          appendFindingMessage(f.createDiv(), message);
        }
      }),
      { mode: PluginNoticeMode.Separate }
    );
  }

  private async resetDatabase(): Promise<void> {
    const currentMtimeEntry = await this.getCurrentMtimeEntry();
    this.appliedFingerprint = currentMtimeEntry;
    this.appliedSettingsFingerprint = currentMtimeEntry.settingsFingerprint;

    this.fileIgnoreMap.clear();
    this.pendingStoreActions.clear();
    this.storeGeneration++;
    this.verdictsLoaded = true;
    await this.database.replace({ entries: [['fingerprint', currentMtimeEntry]], keyPrefix: 'path:' });
  }

  /**
   * Writes {@link text} to `.obsidianignore` after the save in flight, keeping the file's line ending and byte order
   * mark, and applies nothing.
   */
  private async writeLocalPatterns(text: string): Promise<void> {
    const write = this.localPatternsWrite.then(async () => {
      const content = formatLocalPatternsFile({ existingContent: this.localPatternsFileContent, isWindows: Platform.isWin, text });
      await writeSafe({ app: this.app, content, path: OBSIDIAN_IGNORE_FILE });
      this.localPatternsFileContent = content;
      this.cachedLocalPatterns = normalizeLocalPatterns(content);
      // The tab shows the findings of its own edit; only a later edit made elsewhere is reported.
      this.checkLocalPatternErrors(false);
    });
    // A failed save must not stop the ones after it; its caller still gets the error.
    this.localPatternsWrite = write.catch(() => undefined);
    await write;
  }
}

function isSameImportedFileContents(a: ImportedFileContents, b: ImportedFileContents): boolean {
  return a.size === b.size && [...a].every(([path, content]) => b.has(path) && b.get(path) === content);
}
