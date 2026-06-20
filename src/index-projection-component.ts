import type { DataAdapterEx } from '@obsidian-typings/obsidian-public-latest';
import type { App } from 'obsidian';

import { getDataAdapterEx } from '@obsidian-typings/obsidian-public-latest/implementations';
import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';
import { CallbackLayoutReadyComponent } from 'obsidian-dev-utils/obsidian/components/layout-ready-component';
import { isFolder } from 'obsidian-dev-utils/obsidian/file-system';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import type { VaultLoadPatchComponent } from './patches/vault-load-patch-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type {
  VaultModelEntry,
  VisibilityChange
} from './vault-model.ts';
import type { VaultPathStore } from './vault-path-store.ts';

import { ROOT_PATH } from './constants.ts';
import { ExcludeMode } from './plugin-settings.ts';
import { VaultModel } from './vault-model.ts';

export interface IndexProjectionComponentConstructorParams {
  addToFilesPane(this: void, normalizedPath: string): void;
  readonly app: App;
  deleteFromFilesPane(this: void, normalizedPath: string): void;
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
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
  private readonly deleteFromFilesPane: (normalizedPath: string) => void;
  private hasBuiltModel = false;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private updateAbortController: AbortController | null = null;
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

    for (const change of shows) {
      if (abortSignal?.aborted) {
        return;
      }
      await this.show(adapter, change);
    }

    for (const change of hides) {
      if (abortSignal?.aborted) {
        return;
      }
      // In Full mode a hidden node whose parent is also hidden is already removed
      // By the parent's cascading `reconcileDeletion`; skip it. An unknown parent
      // (`undefined`) is treated as a hide-root and still removed.
      if (this.excludeMode === ExcludeMode.Full && this.vaultModel.isParentVisible(change.path) === false) {
        continue;
      }
      await this.hide(adapter, change);
    }
  }

  /**
   * Rebuilds the model from the persisted path set merged with Obsidian's
   * loaded tree, removes the hidden set, and re-adds any visible path missing
   * from the index (e.g. one hidden by a prior session before a disable/enable).
   */
  public async applyFull(abortSignal?: AbortSignal): Promise<void> {
    await this.rebuildModel();
    const adapter = getDataAdapterEx(this.app);
    for (const target of this.getProjectionTargets()) {
      if (abortSignal?.aborted) {
        return;
      }
      await this.hide(adapter, target);
    }

    if (this.excludeMode !== ExcludeMode.Full) {
      return;
    }

    const loadedPaths = new Set(this.app.vault.getAllLoadedFiles().map((file) => file.path));
    for (const entry of this.vaultModel.getPathsByVisibility(true)) {
      if (abortSignal?.aborted) {
        return;
      }
      if (!loadedPaths.has(entry.path)) {
        await this.show(adapter, entry);
      }
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
    this.updateAbortController = new AbortController();
    const abortSignal = this.updateAbortController.signal;
    this.applyingProjectionDepth++;
    try {
      if (this.hasBuiltModel) {
        await this.applyDelta(this.vaultModel.recomputeAll(), abortSignal);
        // Persist the post-change hidden set so a later reload (which does not re-scan disk) can reconstruct and re-show it.
        this.vaultPathStore.save(this.vaultModel.getPathsByVisibility(false));
      } else {
        this.hasBuiltModel = true;
        await this.applyFull(abortSignal);
      }
    } finally {
      this.applyingProjectionDepth--;
      this.updateAbortController = null;
    }
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

  private async rebuildModel(): Promise<void> {
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
    this.vaultModel.rebuild([...byPath.values()]);
    // Persist only the hidden set: merged with Obsidian's loaded (visible) tree on
    // The next build, this reconstructs the full tree without storing all ~90k paths.
    this.vaultPathStore.save(this.vaultModel.getPathsByVisibility(false));
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
