import type { DataAdapterEx } from '@obsidian-typings/obsidian-public-latest';
import type { App } from 'obsidian';

import { getDataAdapterEx } from '@obsidian-typings/obsidian-public-latest/implementations';
import { setImmediateAsync } from 'obsidian-dev-utils/async';
import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';
import { CallbackLayoutReadyComponent } from 'obsidian-dev-utils/obsidian/components/layout-ready-component';
import { isFolder } from 'obsidian-dev-utils/obsidian/file-system';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import type { ManualIndexHider } from './manual-index-hider.ts';
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
 * Number of paths processed between progress-bar updates and cooperative yields
 * during the apply phase. Without periodically yielding a macrotask the whole
 * apply loop would block the main thread (frozen UI, unpainted bar); this bounds
 * each blocking span to roughly this many files.
 */
const APPLY_PROGRESS_REPORT_INTERVAL = 20;

interface IndexProjectionComponentConstructorParams {
  addToFilesPane(this: void, normalizedPath: string): void;
  readonly app: App;
  deleteFromFilesPane(this: void, normalizedPath: string): void;
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly manualIndexHider: ManualIndexHider;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly updateProgressNotice: UpdateProgressNoticeComponent;
  readonly vaultLoadPatch: VaultLoadPatchComponent;
  readonly vaultPathStore: VaultPathStore;
}

/**
 * Projects the {@link VaultModel}'s visibility onto Obsidian's index.
 *
 * Instead of re-reconciling the whole vault, it snapshots Obsidian's already
 * loaded tree into the model and removes only the hidden set. In `Full` mode it
 * removes files from the index via {@link ManualIndexHider} — a direct mutation
 * that fires **no** vault/metadataCache events, so a bulk hide no longer triggers
 * Obsidian's per-file `removeFile` cascade (the source of the multi-minute freeze
 * and the Sync data-loss hazard); the file explorer is driven explicitly. In
 * `FilesPane` mode it only removes items from the explorer pane.
 */
export class IndexProjectionComponent extends ComponentEx {
  /**
   * Whether the projection is currently applying. The adapter patch checks this to
   * skip recording a concurrent real deletion as the projection's own work.
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
  private readonly deleteFromFilesPane: (normalizedPath: string) => void;
  private hasBuiltModel = false;
  private readonly manualIndexHider: ManualIndexHider;
  // Set while a delta is mid-flight: a superseded/aborted delta leaves the model's
  // Visibility ahead of Obsidian (the recompute mutated the model but the apply was
  // Skipped), so the next update must do a full reconcile instead of a stale delta.
  private needsFullProjection = false;
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
    this.manualIndexHider = params.manualIndexHider;
    this.updateProgressNotice = params.updateProgressNotice;
    this.vaultModel = new VaultModel((normalizedPath, isFolderPath) => params.ignorePatternsComponent.isIgnored(normalizedPath, isFolderPath));
  }

  /**
   * Applies the delta produced by an incremental model recompute: shows nodes that
   * flipped visible and hides nodes that flipped hidden.
   *
   * Shows run first, shallowest-first, so a folder is recreated before any file it
   * must contain. Hides run after, deepest-first: each hidden path is removed from
   * the explorer (while it is still in the index), then the whole hidden set is
   * removed from the index in one batched, event-free pass.
   */
  public async applyDelta(changes: readonly VisibilityChange[], abortSignal?: AbortSignal): Promise<void> {
    const adapter = getDataAdapterEx(this.app);
    const shows = changes.filter((change) => change.isVisible).sort((a, b) => pathDepth(a.path) - pathDepth(b.path));
    const hides = changes.filter((change) => !change.isVisible).sort((a, b) => pathDepth(b.path) - pathDepth(a.path));
    const total = shows.length + hides.length;
    let processed = 0;

    for (const change of shows) {
      if (abortSignal?.aborted) {
        return;
      }
      await this.show(adapter, change);
      await this.reportApplyProgress(++processed, total);
    }

    const hiddenPaths: string[] = [];
    for (const change of hides) {
      if (abortSignal?.aborted) {
        return;
      }
      this.deleteFromFilesPane(change.path);
      hiddenPaths.push(change.path);
      await this.reportApplyProgress(++processed, total);
    }
    this.hideFromIndex(hiddenPaths);
  }

  /**
   * Rebuilds the model from the persisted path set merged with Obsidian's loaded
   * tree, removes the hidden set, and re-adds any visible path missing from the
   * index (e.g. one hidden by a prior session before a disable/enable).
   */
  public async applyFull(abortSignal?: AbortSignal): Promise<void> {
    await this.rebuildModel(abortSignal);
    const adapter = getDataAdapterEx(this.app);
    const targets = this.vaultModel.getPathsByVisibility(false).sort((a, b) => pathDepth(b.path) - pathDepth(a.path));
    const missing = this.getMissingVisiblePaths();
    const total = targets.length + missing.length;
    let processed = 0;

    const hiddenPaths: string[] = [];
    for (const target of targets) {
      if (abortSignal?.aborted) {
        return;
      }
      this.deleteFromFilesPane(target.path);
      hiddenPaths.push(target.path);
      await this.reportApplyProgress(++processed, total);
    }
    this.hideFromIndex(hiddenPaths);

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

  /**
   * In `Full` mode, removes the whole hidden set from Obsidian's index in one
   * batched, event-free pass (snapshotting each path so it can be restored without
   * a re-parse). No-op in `FilesPane` mode, where hiding is purely the explorer.
   */
  private hideFromIndex(normalizedPaths: readonly string[]): void {
    if (this.excludeMode === ExcludeMode.Full && normalizedPaths.length > 0) {
      this.manualIndexHider.hide(normalizedPaths);
    }
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
      // Yield a macrotask so the apply loop returns to the event loop — otherwise
      // The UI freezes (and the progress bar never repaints) for the whole apply.
      await setImmediateAsync();
    }
  }

  /**
   * In `Full` mode, restores a path that was hidden this session from its snapshot
   * (no re-parse) and drives the explorer; a path with no snapshot (e.g. hidden by
   * a prior session and never loaded) is re-parsed via `reconcileFile`, which fires
   * its own create event that updates the explorer. In `FilesPane` mode the show is
   * purely the explorer.
   */
  private async show(adapter: DataAdapterEx, entry: VaultModelEntry): Promise<void> {
    if (this.excludeMode !== ExcludeMode.Full) {
      this.addToFilesPane(entry.path);
      return;
    }
    const withoutSnapshot = this.manualIndexHider.show([entry.path]);
    if (withoutSnapshot.length > 0) {
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
