import type { DataAdapterEx } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  MetadataCache
} from 'obsidian';

import { getDataAdapterEx } from '@obsidian-typings/obsidian-public-latest/implementations';
import { setImmediateAsync } from 'obsidian-dev-utils/async';
import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';
import { CallbackLayoutReadyComponent } from 'obsidian-dev-utils/obsidian/components/layout-ready-component';
import { isFolder } from 'obsidian-dev-utils/obsidian/file-system';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import type { VaultLoadPatchComponent } from './patches/vault-load-patch-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type { UpdateProgressNoticeComponent } from './update-progress-notice-component.ts';
import type {
  VaultModelEntry,
  VaultModelRecomputeAllOptions,
  VisibilityChange
} from './vault-model.ts';
import type { VaultPathStore } from './vault-path-store.ts';

import { ROOT_PATH } from './constants.ts';
import { ExcludeMode } from './plugin-settings.ts';
import { VaultModel } from './vault-model.ts';

/**
 * Message shown in the progress notice while the projection updates the tree.
 */
const UPDATE_PROGRESS_MESSAGE = 'Advanced Exclude: updating file tree…';

/**
 * Number of reconcile operations between progress-bar updates and cooperative
 * yields during the apply phase. The reconcile calls resolve on the microtask
 * queue, so without periodically yielding a macrotask the whole apply loop would
 * block the main thread (frozen UI, unpainted bar); this bounds each blocking
 * span to roughly this many files.
 */
const APPLY_PROGRESS_REPORT_INTERVAL = 20;

export interface IndexProjectionComponentConstructorParams {
  addToFilesPane(this: void, normalizedPath: string): void;
  readonly app: App;
  deleteFromFilesPane(this: void, normalizedPath: string): void;
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly updateProgressNotice: UpdateProgressNoticeComponent;
  readonly vaultLoadPatch: VaultLoadPatchComponent;
  readonly vaultPathStore: VaultPathStore;
}

/**
 * Projects the {@link VaultModel}'s visibility onto Obsidian's index.
 *
 * Instead of re-reconciling the whole vault, it snapshots Obsidian's already
 * loaded tree into the model and removes only the hidden set: in `Full` mode via
 * `reconcileDeletion` (which cascades a folder's subtree and unloads it from
 * metadataCache); in `FilesPane` mode by removing items from the explorer pane.
 */
export class IndexProjectionComponent extends ComponentEx {
  /**
   * Whether the projection is currently issuing its own reconcile calls. The
   * adapter patch checks this to skip recording the plugin's own hides as real
   * deletions — otherwise a hide would drop the hidden subtree from the model and
   * a later in-session un-ignore would have nothing left to re-show.
   */
  public get isApplyingProjection(): boolean {
    return this.applyingProjectionDepth > 0;
  }

  public get model(): VaultModel {
    return this.vaultModel;
  }

  private readonly addToFilesPane: (normalizedPath: string) => void;
  private readonly app: App;
  private applyingProjectionDepth = 0;
  private readonly collectedRelatedLinkNames = new Set<string>();
  private readonly deleteFromFilesPane: (normalizedPath: string) => void;
  private hasBuiltModel = false;
  // Set while a delta is mid-flight: a superseded/aborted delta leaves the model's
  // Visibility ahead of Obsidian (the recompute mutated the model but the apply was
  // Skipped), so the next update must do a full reconcile instead of a stale delta.
  private needsFullProjection = false;
  private originalUpdateRelatedLinks: MetadataCache['updateRelatedLinks'] | null = null;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private updateAbortController: AbortController | null = null;
  private readonly updateProgressNotice: UpdateProgressNoticeComponent;
  private readonly vaultLoadPatch: VaultLoadPatchComponent;
  private readonly vaultModel: VaultModel;
  private readonly vaultPathStore: VaultPathStore;

  private get excludeMode(): ExcludeMode {
    return this.pluginSettingsComponent.settings.excludeMode;
  }

  public constructor(params: IndexProjectionComponentConstructorParams) {
    super();
    this.app = params.app;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.vaultLoadPatch = params.vaultLoadPatch;
    this.vaultPathStore = params.vaultPathStore;
    this.addToFilesPane = params.addToFilesPane;
    this.deleteFromFilesPane = params.deleteFromFilesPane;
    this.updateProgressNotice = params.updateProgressNotice;
    this.vaultModel = new VaultModel((normalizedPath, isFolderPath) => params.ignorePatternsComponent.isIgnored(normalizedPath, isFolderPath));
  }

  /**
   * Applies the delta produced by an incremental model recompute: hides nodes
   * that flipped hidden and shows nodes that flipped visible.
   *
   * Shows run first, shallowest-first, so a folder is recreated before any file
   * it must contain. Hides run after; in `Full` mode only the hide-roots (a
   * hidden node whose parent is still visible) are removed, because
   * `reconcileDeletion` cascades the subtree — issuing it per descendant turned a
   * single folder hide into O(subtree) reconcile ops and froze the app.
   */
  public async applyDelta(changes: readonly VisibilityChange[], abortSignal?: AbortSignal): Promise<void> {
    const adapter = getDataAdapterEx(this.app);
    const shows = changes.filter((change) => change.isVisible).sort((a, b) => pathDepth(a.path) - pathDepth(b.path));
    const hides = changes.filter((change) => !change.isVisible);
    const total = shows.length + hides.length;
    let processed = 0;

    for (const change of shows) {
      if (abortSignal?.aborted) {
        return;
      }
      await this.show(adapter, change);
      await this.reportApplyProgress(++processed, total);
    }

    for (const change of hides) {
      if (abortSignal?.aborted) {
        return;
      }
      // In Full mode a hidden node whose parent is also hidden is already removed
      // By the parent's cascading `reconcileDeletion`; skip it. An unknown parent
      // (`undefined`) is treated as a hide-root and still removed.
      if (this.excludeMode === ExcludeMode.Full && this.vaultModel.isParentVisible(change.path) === false) {
        await this.reportApplyProgress(++processed, total);
        continue;
      }
      await this.hide(adapter, change);
      await this.reportApplyProgress(++processed, total);
    }
  }

  /**
   * Rebuilds the model from the persisted path set merged with Obsidian's
   * loaded tree, removes the hidden set, and re-adds any visible path missing
   * from the index (e.g. one hidden by a prior session before a disable/enable).
   */
  public async applyFull(abortSignal?: AbortSignal): Promise<void> {
    await this.rebuildModel(abortSignal);
    const adapter = getDataAdapterEx(this.app);
    const targets = this.getProjectionTargets();
    const missing = this.getMissingVisiblePaths();
    const total = targets.length + missing.length;
    let processed = 0;

    for (const target of targets) {
      if (abortSignal?.aborted) {
        return;
      }
      await this.hide(adapter, target);
      await this.reportApplyProgress(++processed, total);
    }

    for (const entry of missing) {
      if (abortSignal?.aborted) {
        return;
      }
      await this.show(adapter, entry);
      await this.reportApplyProgress(++processed, total);
    }
  }

  /**
   * Number of paths the projection currently hides (used to decide whether an
   * unload restore is cheap enough to do inline).
   */
  public getHiddenCount(): number {
    return this.vaultModel.getPathsByVisibility(false).length;
  }

  public async onLayoutReady(): Promise<void> {
    if (!this.vaultLoadPatch.vaultLoadCalled) {
      await this.update();
    }
  }

  public override async onloadAsync(): Promise<void> {
    await this.update();
    this.addChild(new CallbackLayoutReadyComponent(this.app, this.onLayoutReady.bind(this)));
  }

  public override onunload(): void {
    this.updateAbortController?.abort();
    super.onunload();
  }

  /**
   * Records a path created on disk into the shadow model, so a later config
   * change accounts for it. The live visibility of the path is handled by the
   * adapter patch; this only keeps the model in sync.
   */
  public recordCreate(normalizedPath: string, isFolderPath: boolean): void {
    this.vaultModel.setPath(normalizedPath, isFolderPath);
  }

  /**
   * Records a path deleted on disk into the shadow model.
   */
  public recordDelete(normalizedPath: string): void {
    this.vaultModel.deletePath(normalizedPath);
  }

  /**
   * Refreshes the projection, aborting any in-flight one.
   *
   * The first call builds the model from Obsidian's loaded tree and removes the
   * hidden set. Later calls (e.g. after a pattern change) re-evaluate the
   * persistent model and apply only the delta — so a file that became visible is
   * re-added even though it is no longer in Obsidian's filtered index.
   */
  public async update(): Promise<void> {
    this.updateAbortController?.abort();
    const abortController = new AbortController();
    this.updateAbortController = abortController;
    const abortSignal = abortController.signal;
    this.beginProjection();
    this.updateProgressNotice.start(UPDATE_PROGRESS_MESSAGE);
    try {
      if (!this.hasBuiltModel || this.needsFullProjection) {
        this.hasBuiltModel = true;
        await this.applyFull(abortSignal);
      } else {
        // Pessimistic: assume this delta will be superseded, so a concurrent/next
        // Update reconciles fully (a superseded delta leaves the model ahead of
        // Obsidian). Cleared below only once we finish without an abort.
        this.needsFullProjection = true;
        const changes = await this.vaultModel.recomputeAll(this.createRecomputeOptions(abortSignal));
        if (abortSignal.aborted) {
          return;
        }
        await this.applyDelta(changes, abortSignal);
        // Persist the post-change hidden set so a later reload (which does not re-scan disk) can reconstruct and re-show it.
        this.vaultPathStore.save(this.vaultModel.getPathsByVisibility(false));
      }

      if (abortSignal.aborted) {
        return;
      }
      this.needsFullProjection = false;
    } finally {
      this.endProjection();
      // Only the current update owns the notice/controller: a superseding update
      // Already replaced them, so a superseded run must not hide the new notice.
      if (this.updateAbortController === abortController) {
        this.updateProgressNotice.finish();
        this.updateAbortController = null;
      }
    }
  }

  private beginProjection(): void {
    if (this.applyingProjectionDepth === 0) {
      this.installRelatedLinksBatching();
    }
    this.applyingProjectionDepth++;
  }

  private createRecomputeOptions(abortSignal?: AbortSignal): VaultModelRecomputeAllOptions {
    const options: VaultModelRecomputeAllOptions = {
      onProgress: (processed, total) => {
        this.updateProgressNotice.report(processed, total);
      },
      // SetImmediate (not requestAnimationFrame) so the recompute keeps progressing
      // Even when the Obsidian window is unfocused/hidden — rAF is paused there,
      // Which would stall the update. It still lets the UI paint between chunks.
      yieldFn: setImmediateAsync
    };
    return abortSignal ? { ...options, abortSignal } : options;
  }

  private endProjection(): void {
    this.applyingProjectionDepth--;
    if (this.applyingProjectionDepth === 0) {
      this.flushRelatedLinksBatching();
    }
  }

  private flushRelatedLinksBatching(): void {
    const original = this.originalUpdateRelatedLinks;
    if (!original) {
      return;
    }
    this.app.metadataCache.updateRelatedLinks = original;
    this.originalUpdateRelatedLinks = null;
    if (this.collectedRelatedLinkNames.size > 0) {
      this.app.metadataCache.updateRelatedLinks([...this.collectedRelatedLinkNames]);
      this.collectedRelatedLinkNames.clear();
    }
  }

  /**
   * In `Full` mode, the visible paths the model knows about that Obsidian's index
   * no longer holds (e.g. files a prior session hid before a disable/enable) and
   * must be re-added. Empty in `FilesPane` mode.
   */
  private getMissingVisiblePaths(): VaultModelEntry[] {
    if (this.excludeMode !== ExcludeMode.Full) {
      return [];
    }
    const loadedPaths = new Set(this.app.vault.getAllLoadedFiles().map((file) => file.path));
    return this.vaultModel.getPathsByVisibility(true).filter((entry) => !loadedPaths.has(entry.path));
  }

  private getProjectionTargets(): VaultModelEntry[] {
    return this.excludeMode === ExcludeMode.Full ? this.vaultModel.getHideRoots() : this.vaultModel.getPathsByVisibility(false);
  }

  private async hide(adapter: DataAdapterEx, entry: VaultModelEntry): Promise<void> {
    if (this.excludeMode === ExcludeMode.Full) {
      await adapter.reconcileDeletion(entry.path, entry.path);
    } else {
      this.deleteFromFilesPane(entry.path);
    }
  }

  /**
   * In `Full` mode the hide issues `reconcileDeletion`, whose internal cascade
   * calls `MetadataCache.updateRelatedLinks` once per deleted file — and each call
   * scans every file in the vault, making a folder hide O(N²) (a ~16 min 90k hide).
   * While the projection runs, collect the names instead of scanning; one pass
   * afterwards re-resolves them all (by then the hidden files are gone from the
   * cache, so the single scan is cheap), turning the hide into seconds.
   */
  private installRelatedLinksBatching(): void {
    if (this.excludeMode !== ExcludeMode.Full) {
      return;
    }
    const metadataCache = this.app.metadataCache;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- captured to restore on the same object later, never called detached.
    this.originalUpdateRelatedLinks = metadataCache.updateRelatedLinks;
    const collected = this.collectedRelatedLinkNames;
    collected.clear();
    /*
     * The public typings mistype the param as a single string; the real method
     * takes an array. Accept both and flatten so the assignment satisfies both
     * overloads without a runtime branch.
     */
    metadataCache.updateRelatedLinks = (namesOrPath: string | string[]): void => {
      for (const name of [namesOrPath].flat()) {
        collected.add(name);
      }
    };
  }

  private async rebuildModel(abortSignal?: AbortSignal): Promise<void> {
    const byPath = new Map<string, VaultModelEntry>();
    for (const entry of await this.vaultPathStore.load()) {
      byPath.set(entry.path, entry);
    }
    for (const file of this.app.vault.getAllLoadedFiles()) {
      if (file.path === ROOT_PATH) {
        continue;
      }
      byPath.set(file.path, { isFolder: isFolder(file), path: file.path });
    }
    await this.vaultModel.rebuild([...byPath.values()], this.createRecomputeOptions(abortSignal));
    // Persist only the hidden set: merged with Obsidian's loaded (visible) tree on
    // The next build, this reconstructs the full tree without storing all ~90k paths.
    this.vaultPathStore.save(this.vaultModel.getPathsByVisibility(false));
  }

  private async reportApplyProgress(processed: number, total: number): Promise<void> {
    if (processed % APPLY_PROGRESS_REPORT_INTERVAL === 0 || processed === total) {
      this.updateProgressNotice.report(processed, total);
      // Yield a macrotask: the reconcile calls resolve on the microtask queue, so
      // Without this the apply loop never returns to the event loop and the UI
      // Freezes (and the progress bar never repaints) for the whole apply.
      await setImmediateAsync();
    }
  }

  private async show(adapter: DataAdapterEx, entry: VaultModelEntry): Promise<void> {
    if (this.excludeMode === ExcludeMode.Full) {
      await adapter.reconcileFile(entry.path, entry.path);
    } else {
      this.addToFilesPane(entry.path);
    }
  }
}

function pathDepth(normalizedPath: string): number {
  let count = 1;
  for (const char of normalizedPath) {
    if (char === '/') {
      count++;
    }
  }
  return count;
}
