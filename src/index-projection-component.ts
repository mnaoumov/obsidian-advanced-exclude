import type { DataAdapterEx } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  View
} from 'obsidian';

import { getDataAdapterEx } from '@obsidian-typings/obsidian-public-latest/implementations';
import { requestAnimationFrameAsync } from 'obsidian-dev-utils/async';
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
import { computeUniverseSignature } from './universe-signature.ts';
import { VaultModel } from './vault-model.ts';

/**
 * Message shown in the progress notice while the projection updates the tree.
 */
const UPDATE_PROGRESS_MESSAGE = 'Updating file tree…';

/**
 * Minimum wall-clock gap between progress-bar updates and cooperative yields
 * during the apply phase.
 *
 * The yield cadence is time-based, not per-N-items: each `await
 * requestAnimationFrameAsync()` costs roughly one frame (~16 ms), so yielding on a
 * fixed item count made the apply loop's wall-clock scale with the item count
 * rather than the work — a whole-vault hide of ~90k paths at the old every-20-items
 * cadence spent ~4,500 frame-waits (~72 s) yielding, while the real index work was
 * well under a second. Yielding only once this many milliseconds have elapsed keeps
 * the bar responsive (~20 repaints/s) while making the yield overhead a function of
 * elapsed time, not vault size.
 */
const APPLY_YIELD_INTERVAL_IN_MILLISECONDS = 50;

/**
 * The link-dependent side-pane view types refreshed after a `Full`-mode projection. Their
 * renderers recompute only on an active-file change or a `metadataCache` event — neither of
 * which the event-free projection fires — so they would otherwise show stale links (a hidden
 * file lingering as a backlink) until the next interaction.
 */
const LINK_VIEW_TYPES = ['backlink', 'outgoing-link'];

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

interface IndexProjectionComponentRecordCreateParams {
  readonly isFolderPath: boolean;
  readonly normalizedPath: string;
}

interface IndexProjectionComponentReportApplyProgressParams {
  readonly processed: number;
  readonly total: number;
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

  private readonly addToFilesPane: (normalizedPath: string) => void;
  private readonly app: App;
  private applyingProjectionDepth = 0;
  private readonly deleteFromFilesPane: (normalizedPath: string) => void;
  // Set once the fast-enable path applied the persisted hide directly (no full model
  // Build). Suppresses the `onLayoutReady` re-`update()` that would otherwise trigger a
  // Whole-vault `applyFull` and undo the win; cleared when a full build supersedes it.
  private fastEnableApplied = false;
  private hasBuiltModel = false;
  // Guards `restoreHiddenFilesOnUnload` so the on-disable restore runs at most once
  // (it is invoked by both `RestoreNoticeComponent.onunload` and this component's own
  // `onunload` fallback — see `restoreHiddenFilesOnUnload`).
  private hasRestoredOnUnload = false;
  private readonly ignorePatternsComponent: IgnorePatternsComponent;
  // Set once Obsidian starts quitting: an unload during app shutdown must not spend
  // Time restoring the index/explorer (both are being torn down). See the `'quit'`
  // Registration in `onloadAsync` and the guard in `restoreHiddenFilesOnUnload`.
  private isQuitting = false;
  // Timestamp of the last cooperative yield during an apply phase; drives the
  // Time-based yield cadence in `reportApplyProgress` (see APPLY_YIELD_INTERVAL_IN_MILLISECONDS).
  private lastApplyYieldInMilliseconds = 0;
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
    this.ignorePatternsComponent = params.ignorePatternsComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.vaultLoadPatch = params.vaultLoadPatch;
    this.vaultPathStore = params.vaultPathStore;
    this.addToFilesPane = params.addToFilesPane;
    this.deleteFromFilesPane = params.deleteFromFilesPane;
    this.manualIndexHider = params.manualIndexHider;
    this.updateProgressNotice = params.updateProgressNotice;
    this.vaultModel = new VaultModel(
      (normalizedPath, isFolderPath) => params.ignorePatternsComponent.isIgnored({ isFolder: isFolderPath, normalizedPath }),
      () => this.pluginSettingsComponent.settings.shouldHideEmptyFolders
    );
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
    this.lastApplyYieldInMilliseconds = performance.now();
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
      await this.reportApplyProgress({ processed: ++processed, total });
    }

    const hiddenPaths: string[] = [];
    for (const change of hides) {
      if (abortSignal?.aborted) {
        return;
      }
      this.deleteFromFilesPane(change.path);
      hiddenPaths.push(change.path);
      await this.reportApplyProgress({ processed: ++processed, total });
    }
    this.hideFromIndex(hiddenPaths);
  }

  /**
   * Rebuilds the model from the persisted path set merged with Obsidian's loaded
   * tree, removes the hidden set, and re-adds any visible path missing from the
   * index (e.g. one hidden by a prior session before a disable/enable).
   */
  public async applyFull(abortSignal?: AbortSignal): Promise<void> {
    // A full build replaces any fast-enable seed, so the `onLayoutReady` guard no
    // Longer applies.
    this.fastEnableApplied = false;
    await this.rebuildModel(abortSignal);
    this.lastApplyYieldInMilliseconds = performance.now();
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
      await this.reportApplyProgress({ processed: ++processed, total });
    }
    this.hideFromIndex(hiddenPaths);

    for (const entry of missing) {
      if (abortSignal?.aborted) {
        return;
      }
      await this.show(adapter, entry);
      await this.reportApplyProgress({ processed: ++processed, total });
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
    // The fast-enable path already applied the persisted hide; a full `update()` here
    // Would trigger a whole-vault `applyFull` and undo the win.
    if (this.fastEnableApplied) {
      return;
    }
    if (!this.vaultLoadPatch.wasVaultLoadCalled) {
      await this.update();
    }
  }

  public override async onloadAsync(): Promise<void> {
    // A disable during app shutdown must skip the restore (see `restoreHiddenFilesOnUnload`):
    // The index and file explorer are being torn down, so re-inserting the hidden set is
    // Wasted work. `'quit'` fires before the teardown, so the flag is set in time.
    this.registerEvent(this.app.workspace.on('quit', () => {
      this.isQuitting = true;
    }));
    // Own an abort controller for the whole enable up front so an `onunload` during the
    // Fast-enable check (its `await` on the persisted store) still aborts the enable —
    // Otherwise `update()` would set the controller too late and hide into a torn-down
    // Component. `update()` replaces it with its own on the fall-back path.
    const abortController = new AbortController();
    this.updateAbortController = abortController;
    // Fast path: on a warm re-enable with an unchanged config and file universe,
    // Re-hide the persisted set directly and defer the whole-vault build. Falls back
    // To the proven full `update()` when not eligible.
    const didFastEnable = await this.tryFastEnable(abortController.signal);
    if (abortController.signal.aborted) {
      return;
    }
    if (!didFastEnable) {
      await this.update();
    }
    this.addChild(new CallbackLayoutReadyComponent(this.app, this.onLayoutReady.bind(this)));
  }

  public override onunload(): void {
    this.updateAbortController?.abort();
    // Defensive fallback: `RestoreNoticeComponent.onunload` (which unloads first, being added
    // Later) normally drives the restore before this runs, so this is a no-op then. It stays
    // Here so the index is still restored if the child add-order ever changes.
    this.restoreHiddenFilesOnUnload();
    super.onunload();
  }

  /**
   * Records a path created on disk into the shadow model, so a later config
   * change accounts for it. The live visibility of the path is handled by the
   * adapter patch; this only keeps the model in sync.
   */
  public recordCreate(params: IndexProjectionComponentRecordCreateParams): void {
    const { isFolderPath, normalizedPath } = params;
    this.vaultModel.setPath({ isFolder: isFolderPath, normalizedPath });
  }

  /**
   * Records a path deleted on disk into the shadow model.
   */
  public recordDelete(normalizedPath: string): void {
    this.vaultModel.deletePath(normalizedPath);
  }

  /**
   * Restores the index on disable so the file tree returns to its original state
   * without an app reload or a re-index — the fix for the "vault session
   * interrupted" complaint (issue #10).
   *
   * Every path hidden this session carries an in-memory {@link ManualIndexHider}
   * snapshot, so `show` restores it verbatim and synchronously (no `stat` /
   * `reconcileFile`), which is what makes this safe to run in the synchronous
   * `onunload`. Idempotent (guarded by {@link hasRestoredOnUnload}) because it is
   * invoked from both `RestoreNoticeComponent.onunload` (which unloads first and so
   * actually performs the restore in time) and this component's own `onunload`
   * fallback.
   *
   * Returns whether the index is fully restored — `true` unless a path the model
   * still considers hidden had no snapshot (e.g. one hidden by a prior session and
   * never loaded, hence never in the index this session). The notice falls back to
   * its "Reload the app" message only when this returns `false`.
   */
  public restoreHiddenFilesOnUnload(): boolean {
    if (this.hasRestoredOnUnload) {
      return true;
    }
    this.hasRestoredOnUnload = true;

    // On app shutdown the index and explorer are being destroyed — restoring is
    // Wasted work, and driving the tearing-down explorer could throw.
    if (this.isQuitting) {
      return true;
    }

    // `FilesPane` mode never mutates the index (`hideFromIndex` is a no-op), so there
    // Is nothing to restore and no reload is ever needed.
    if (this.excludeMode !== ExcludeMode.Full) {
      return true;
    }

    const hidden = this.vaultModel.getPathsByVisibility(false);
    const withoutSnapshot = new Set(this.manualIndexHider.show(hidden.map((entry) => entry.path)));
    // Show shallowest-first so a folder is re-inserted into the explorer before any
    // File it must contain.
    const restored = hidden
      .filter((entry) => !withoutSnapshot.has(entry.path))
      .sort((a, b) => pathDepth(a.path) - pathDepth(b.path));
    for (const entry of restored) {
      this.addToFilesPane(entry.path);
    }
    this.refreshLinkViews();
    return withoutSnapshot.size === 0;
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
      // Let the notice (and its indeterminate bar) paint before the first synchronous
      // Slice of recompute/apply work. `start()` only inserts the DOM; without this yield
      // The browser would not paint it until the first internal yield (after a recompute
      // Chunk or `rebuildModel`'s node-build), so on a large vault the bar would appear
      // Late — the very "looks frozen / nothing happening" perception this guards against.
      // An abort during this yield needs no check here: `recomputeAll`/`applyFull` short-
      // Circuit on the signal, and the post-phase `aborted` checks below still bail.
      await requestAnimationFrameAsync();
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
        this.persistHiddenSet();
      }

      if (abortSignal.aborted) {
        return;
      }
      this.needsFullProjection = false;
      if (this.excludeMode === ExcludeMode.Full) {
        this.refreshLinkViews();
      }
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

  /**
   * A stable, order-independent signature of the whole loaded-file universe
   * (`hidden ∪ loaded`, deduplicated) used to guard the fast-enable path: it detects
   * files created/deleted on disk while the plugin was disabled, which the ignore
   * fingerprint cannot. Computed identically at persist time and at enable time
   * (see {@link computeUniverseSignature}).
   */
  private computeUniverseSignature(hiddenEntries: readonly VaultModelEntry[]): string {
    const paths: string[] = [];
    for (const file of this.app.vault.getAllLoadedFiles()) {
      if (file.path !== ROOT_PATH) {
        paths.push(file.path);
      }
    }
    for (const entry of hiddenEntries) {
      paths.push(entry.path);
    }
    return computeUniverseSignature(paths);
  }

  private createRecomputeOptions(abortSignal?: AbortSignal): VaultModelRecomputeAllOptions {
    const options: VaultModelRecomputeAllOptions = {
      onProgress: (processed, total) => {
        this.updateProgressNotice.report({ processed, total });
      },
      // Yield aligned to a paint frame so the progress bar actually repaints
      // Between chunks. `requestAnimationFrameAsync` falls back to a timeout so
      // An unfocused/hidden window (where rAF is paused) keeps progressing.
      yieldFunction: requestAnimationFrameAsync
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

  /**
   * If a file's snapshot is stale — its `mtime`/`size` on disk no longer match what was
   * captured when it was hidden (it was edited on disk while hidden) — discards the snapshot
   * so the show falls through to a `reconcileFile` re-parse with fresh content instead of
   * restoring the stale cache. The common case (file untouched while hidden) keeps its
   * snapshot and restores instantly.
   */
  private async invalidateStaleSnapshot(adapter: DataAdapterEx, entry: VaultModelEntry): Promise<void> {
    if (entry.isFolder || !this.manualIndexHider.hasSnapshot(entry.path)) {
      return;
    }
    const snapshotStat = this.manualIndexHider.getSnapshotStat(entry.path);
    if (!snapshotStat) {
      return;
    }
    const diskStat = await adapter.stat(entry.path);
    if (diskStat && (diskStat.mtime !== snapshotStat.mtime || diskStat.size !== snapshotStat.size)) {
      this.manualIndexHider.dropStaleSnapshot(entry.path);
    }
  }

  /**
   * Persists the current hidden set plus its universe signature. Persisting only the
   * hidden set (merged with Obsidian's loaded tree on the next build) reconstructs the
   * full tree without storing all ~90k paths; the signature lets the next enable verify
   * the vault is unchanged before taking the fast path.
   */
  private persistHiddenSet(): void {
    const hidden = this.vaultModel.getPathsByVisibility(false);
    this.vaultPathStore.save(hidden, this.computeUniverseSignature(hidden));
  }

  private async rebuildModel(abortSignal?: AbortSignal): Promise<void> {
    // A full recompute evaluates every node's ignore verdict, so warm the persisted
    // Verdict cache first (deferred off the fast-enable path). A no-op after a config
    // Reset, whose recompute is intentionally cold.
    await this.ignorePatternsComponent.ensureVerdictsLoaded();
    const byPath = new Map<string, VaultModelEntry>();
    // The model's own hidden paths come first, because neither source below can supply them: in
    // `Full` mode a hidden path never enters Obsidian's index, and the store only holds what an
    // Earlier projection persisted. A path recorded since then (`recordCreate`) would otherwise be
    // Dropped from the rebuilt universe — and a folder whose only child is dropped reads as
    // GENUINELY empty, so `shouldHideEmptyFolders` would keep the emptied chain visible.
    for (const entry of this.vaultModel.getPathsByVisibility(false)) {
      byPath.set(entry.path, entry);
    }
    const stored = await this.vaultPathStore.load();
    for (const entry of stored.entries) {
      byPath.set(entry.path, entry);
    }
    for (const file of this.app.vault.getAllLoadedFiles()) {
      if (file.path === ROOT_PATH) {
        continue;
      }
      byPath.set(file.path, { isFolder: isFolder(file), path: file.path });
    }
    await this.vaultModel.rebuild([...byPath.values()], this.createRecomputeOptions(abortSignal));
    this.persistHiddenSet();
  }

  /**
   * Nudges the open link side-panes (Backlinks, Outgoing Links) to recompute after a
   * `Full`-mode projection. The projection mutates the link index without firing events, so
   * these views would otherwise render stale links (a hidden file lingering as a backlink)
   * until the next interaction. Their renderers are undocumented internals, so the refresh
   * is fully guarded — a no-op when a view exposes no matching renderer.
   */
  private refreshLinkViews(): void {
    for (const viewType of LINK_VIEW_TYPES) {
      for (const leaf of this.app.workspace.getLeavesOfType(viewType)) {
        refreshLinkRenderer(leaf.view);
      }
    }
  }

  private async reportApplyProgress(params: IndexProjectionComponentReportApplyProgressParams): Promise<void> {
    const { processed, total } = params;
    // Time-based cadence: yield only once APPLY_YIELD_INTERVAL_IN_MILLISECONDS have
    // Elapsed since the last yield (always at completion). A per-item-count cadence
    // Made the loop's wall-clock scale with the item count — each yield is ~one frame,
    // So ~90k items / 20 ≈ 4,500 frames ≈ 72 s of pure yielding for <1 s of real work.
    const now = performance.now();
    if (processed !== total && now - this.lastApplyYieldInMilliseconds < APPLY_YIELD_INTERVAL_IN_MILLISECONDS) {
      return;
    }
    this.lastApplyYieldInMilliseconds = now;
    this.updateProgressNotice.report({ processed, total });
    // Yield to a paint frame so the apply loop returns to the event loop and the
    // Progress bar repaints — otherwise the UI freezes for the whole apply.
    await requestAnimationFrameAsync();
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
    await this.invalidateStaleSnapshot(adapter, entry);
    const withoutSnapshot = this.manualIndexHider.show([entry.path]);
    if (withoutSnapshot.length > 0) {
      // The prior session's hide removed the path from `vault.fileMap`/`metadataCache`
      // But left the adapter's own stat record intact, so `reconcileFile` would compare
      // Disk against that stale record, see no change, and re-add nothing. Drop the
      // Record first so `reconcileFile` treats the still-on-disk file as new.
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- invalidate the adapter's stale stat record so the re-parse re-adds the file.
      delete adapter.files[entry.path];
      await adapter.reconcileFile(entry.path, entry.path);
    } else {
      this.addToFilesPane(entry.path);
    }
  }

  /**
   * Fast enable: on a warm re-enable whose ignore config **and** file universe are
   * unchanged, re-hide the persisted set directly instead of rebuilding and
   * recomputing the whole ~90k model. Seeds the model with just the persisted hidden
   * set (so `getPathsByVisibility(false)` — hence a later disable-restore — still sees
   * it), then hides those paths from the index in one batched pass. The full model
   * build and verdict-cache warm-up are deferred to the next config change (which
   * takes the `!hasBuiltModel` → `applyFull` branch).
   *
   * Returns whether the fast path was taken. Ineligible — and the caller falls back to
   * the proven full `update()` — when not in `Full` mode, the config fingerprint
   * changed, there is no persisted hidden set, or the universe signature does not match
   * (files changed on disk while disabled, or a cold start where the vault is not yet
   * loaded so the signature cannot match).
   */
  private async tryFastEnable(abortSignal: AbortSignal): Promise<boolean> {
    if (this.excludeMode !== ExcludeMode.Full || !this.ignorePatternsComponent.isConfigUnchanged()) {
      return false;
    }

    const stored = await this.vaultPathStore.load();
    // A disable during the `load()` above unloaded the component; do not mutate the index.
    if (abortSignal.aborted) {
      return false;
    }
    if (stored.universeSignature === null || stored.entries.length === 0) {
      return false;
    }
    if (this.computeUniverseSignature(stored.entries) !== stored.universeSignature) {
      return false;
    }

    this.beginProjection();
    try {
      this.vaultModel.seedHidden(stored.entries);
      const targets = [...stored.entries].sort((a, b) => pathDepth(b.path) - pathDepth(a.path));
      const hiddenPaths: string[] = [];
      for (const target of targets) {
        this.deleteFromFilesPane(target.path);
        hiddenPaths.push(target.path);
      }
      this.hideFromIndex(hiddenPaths);
      this.refreshLinkViews();
    } finally {
      this.endProjection();
    }

    this.fastEnableApplied = true;
    return true;
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

/**
 * Forces a link side-pane renderer to recompute from the current link cache. The renderer
 * caches the file it last rendered in its `*File` fields and its `update()` short-circuits
 * while they still match the active file; clearing those trackers (but not `file`, the
 * current target) makes `update()` recompute. Guarded: a no-op when the view exposes no
 * such renderer.
 */
function refreshLinkRenderer(view: View): void {
  for (const renderer of [view.backlink, view.outgoingLink]) {
    if (!renderer) {
      continue;
    }
    renderer.backlinkFile = null;
    renderer.outgoingFile = null;
    renderer.unlinkedFile = null;
    renderer.update?.();
  }
}
