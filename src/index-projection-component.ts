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
  public get model(): VaultModel {
    return this.vaultModel;
  }

  private readonly addToFilesPane: (normalizedPath: string) => void;
  private readonly app: App;
  private readonly deleteFromFilesPane: (normalizedPath: string) => void;
  private hasBuiltModel = false;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private updateAbortController: AbortController | null = null;
  private readonly vaultLoadPatch: VaultLoadPatchComponent;
  private readonly vaultModel: VaultModel;

  private get excludeMode(): ExcludeMode {
    return this.pluginSettingsComponent.settings.excludeMode;
  }

  public constructor(params: IndexProjectionComponentConstructorParams) {
    super();
    this.app = params.app;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.vaultLoadPatch = params.vaultLoadPatch;
    this.addToFilesPane = params.addToFilesPane;
    this.deleteFromFilesPane = params.deleteFromFilesPane;
    this.vaultModel = new VaultModel((normalizedPath, isFolderPath) => params.ignorePatternsComponent.isIgnored(normalizedPath, isFolderPath));
  }

  /**
   * Applies the delta produced by an incremental model recompute: hides nodes
   * that flipped hidden and shows nodes that flipped visible.
   */
  public async applyDelta(changes: readonly VisibilityChange[], abortSignal?: AbortSignal): Promise<void> {
    const adapter = getDataAdapterEx(this.app);
    for (const change of changes) {
      if (abortSignal?.aborted) {
        return;
      }
      if (change.isVisible) {
        await this.show(adapter, change);
      } else {
        await this.hide(adapter, change);
      }
    }
  }

  /**
   * Snapshots Obsidian's loaded tree into the model and removes the hidden set.
   */
  public async applyFull(abortSignal?: AbortSignal): Promise<void> {
    this.rebuildModel();
    const adapter = getDataAdapterEx(this.app);
    for (const target of this.getProjectionTargets()) {
      if (abortSignal?.aborted) {
        return;
      }
      await this.hide(adapter, target);
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
   * Re-adds every node the projection currently hides (used on unload).
   */
  public async restoreAll(): Promise<void> {
    const adapter = getDataAdapterEx(this.app);
    for (const target of this.getProjectionTargets()) {
      await this.show(adapter, target);
    }
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
    try {
      if (this.hasBuiltModel) {
        await this.applyDelta(this.vaultModel.recomputeAll(), abortSignal);
      } else {
        this.hasBuiltModel = true;
        await this.applyFull(abortSignal);
      }
    } finally {
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

  private rebuildModel(): void {
    const entries: VaultModelEntry[] = this.app.vault.getAllLoadedFiles()
      .filter((file) => file.path !== ROOT_PATH)
      .map((file) => ({ isFolder: isFolder(file), path: file.path }));
    this.vaultModel.rebuild(entries);
  }

  private async show(adapter: DataAdapterEx, entry: VaultModelEntry): Promise<void> {
    if (this.excludeMode === ExcludeMode.Full) {
      await adapter.reconcileFile(entry.path, entry.path);
    } else {
      this.addToFilesPane(entry.path);
    }
  }
}
