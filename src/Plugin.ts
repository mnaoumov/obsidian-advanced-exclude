import type {
  DataAdapter,
  TAbstractFile,
  Vault
} from 'obsidian';
import type { ExtractPluginSettingsWrapper } from 'obsidian-dev-utils/obsidian/Plugin/PluginTypesBase';
import type { FileExplorerView } from 'obsidian-typings';
import type { ReadonlyObjectDeep } from 'type-fest/source/readonly-deep.js';

import {
  CapacitorAdapter,
  FileSystemAdapter,
  Notice
} from 'obsidian';
import {
  ignoreError,
  invokeAsyncSafely,
  throwOnAbort
} from 'obsidian-dev-utils/Async';
import { getPrototypeOf } from 'obsidian-dev-utils/ObjectUtils';
import { isFolder as isFolderFn } from 'obsidian-dev-utils/obsidian/FileSystem';
import { ensureMetadataCacheReady } from 'obsidian-dev-utils/obsidian/MetadataCache';
import { registerPatch } from 'obsidian-dev-utils/obsidian/MonkeyAround';
import { PluginBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginBase';
import { basename } from 'obsidian-dev-utils/Path';

import type { PluginTypes } from './PluginTypes.ts';

import {
  IgnorePatternsComponent,
  ROOT_PATH
} from './IgnorePatternsComponent.ts';
import { ExcludeMode } from './PluginSettings.ts';
import { PluginSettingsManager } from './PluginSettingsManager.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';

type CapacitorAdapterReconcileFileCreationFn = CapacitorAdapter['reconcileFileCreation'];
type DataAdapterReconcileDeletionFn = DataAdapter['reconcileDeletion'];
type DataAdapterReconcileFolderCreationFn = DataAdapter['reconcileFolderCreation'];
type FileSystemAdapterReconcileFileCreationFn = FileSystemAdapter['reconcileFileCreation'];
type GenericReconcileFn = (normalizedPath: string, ...args: unknown[]) => Promise<void>;
type OnCreateFn = FileExplorerView['onCreate'];
type VaultLoadFn = Vault['load'];

export class Plugin extends PluginBase<PluginTypes> {
  private hadConfigChanges = false;
  private ignorePatternsComponent!: IgnorePatternsComponent;
  private updateFileTreeAbortController: AbortController | null = null;
  private updateProgressEl!: HTMLProgressElement;
  private vaultLoadCalled = false;

  public override async onLoadSettings(loadedSettings: ReadonlyObjectDeep<ExtractPluginSettingsWrapper<PluginTypes>>, isInitialLoad: boolean): Promise<void> {
    await super.onLoadSettings(loadedSettings, isInitialLoad);
    if (isInitialLoad) {
      return;
    }

    await this.ignorePatternsComponent.readObsidianIgnore();
  }

  public async processConfigChanges(): Promise<void> {
    if (!this.hadConfigChanges) {
      return;
    }

    this.hadConfigChanges = false;
    await this.ignorePatternsComponent.processConfigChanges();
  }

  public async updateFileTree(): Promise<void> {
    const NOTIFICATION_MIN_DURATION_IN_MS = 2000;

    if (this.updateFileTreeAbortController) {
      this.updateFileTreeAbortController.abort();
    }

    this.updateFileTreeAbortController = new AbortController();
    const abortSignal = this.updateFileTreeAbortController.signal;
    const fragment = createFragment((f) => {
      f.appendText('Advanced Exclude: Updating file tree...');
      this.updateProgressEl = f.createEl('progress');
    });
    const notice = new Notice(fragment, 0);
    try {
      await Promise.race([
        Promise.all([this.reloadFolder(ROOT_PATH, abortSignal), sleep(NOTIFICATION_MIN_DURATION_IN_MS, abortSignal)]),
      ]);
    } finally {
      notice.hide();
      this.updateFileTreeAbortController = null;
    }
  }

  protected override createSettingsManager(): PluginSettingsManager {
    return new PluginSettingsManager(this);
  }

  protected override createSettingsTab(): null | PluginSettingsTab {
    return new PluginSettingsTab(this);
  }

  protected override async onLayoutReady(): Promise<void> {
    await super.onLayoutReady();
    await ensureMetadataCacheReady(this.app);

    this.registerEvent(this.app.vault.on('config-changed', (configKey: string) => {
      if (configKey === 'userIgnoreFilters') {
        this.ignorePatternsComponent.clearCachedExcludeRegExps();
      }
    }));

    this.register(() => {
      invokeAsyncSafely(() => this.updateFileTree());
    });

    if (!this.vaultLoadCalled) {
      await this.updateFileTree();
    }

    const that = this;
    const view = this.getFileExplorerView();
    if (view) {
      registerPatch(this, getPrototypeOf(view), {
        onCreate: (next: OnCreateFn): OnCreateFn => {
          return function onCreatePatched(this: FileExplorerView, file: TAbstractFile): void {
            that.onCreate(next, this, file);
          };
        }
      });
    }
  }

  protected override async onloadImpl(): Promise<void> {
    await super.onloadImpl();
    this.ignorePatternsComponent = new IgnorePatternsComponent(this);

    registerPatch(this, this.app.vault, {
      load: (next: VaultLoadFn): VaultLoadFn => {
        return () => this.vaultLoad(next);
      }
    });

    this.addChild(this.ignorePatternsComponent);
    if (this.app.vault.adapter instanceof CapacitorAdapter) {
      registerPatch(this, this.app.vault.adapter, {
        reconcileDeletion: (next: DataAdapterReconcileDeletionFn): DataAdapterReconcileDeletionFn => {
          return async (normalizedPath: string, normalizedNewPath: string, shouldSkipDeletionTimeout?: boolean): Promise<void> => {
            return this.reconcileDeletion(next, normalizedPath, normalizedNewPath, shouldSkipDeletionTimeout);
          };
        },
        reconcileFileCreation: (next: CapacitorAdapterReconcileFileCreationFn): CapacitorAdapterReconcileFileCreationFn =>
          this.generateReconcileWrapper(next as GenericReconcileFn, false),
        reconcileFolderCreation: (next: DataAdapterReconcileFolderCreationFn): DataAdapterReconcileFolderCreationFn =>
          this.generateReconcileWrapper(next as GenericReconcileFn, true)
      });
    } else if (this.app.vault.adapter instanceof FileSystemAdapter) {
      registerPatch(this, this.app.vault.adapter, {
        reconcileDeletion: (next: DataAdapterReconcileDeletionFn): DataAdapterReconcileDeletionFn => {
          return async (normalizedPath: string, normalizedNewPath: string, shouldSkipDeletionTimeout?: boolean): Promise<void> => {
            return this.reconcileDeletion(next, normalizedPath, normalizedNewPath, shouldSkipDeletionTimeout);
          };
        },
        reconcileFileCreation: (next: FileSystemAdapterReconcileFileCreationFn): FileSystemAdapterReconcileFileCreationFn =>
          this.generateReconcileWrapper(next as GenericReconcileFn, false),
        reconcileFolderCreation: (next: DataAdapterReconcileFolderCreationFn): DataAdapterReconcileFolderCreationFn =>
          this.generateReconcileWrapper(next as GenericReconcileFn, true)
      });
    }
  }

  protected override async onSaveSettings(
    newSettings: ReadonlyObjectDeep<ExtractPluginSettingsWrapper<PluginTypes>>,
    oldSettings: ReadonlyObjectDeep<ExtractPluginSettingsWrapper<PluginTypes>>,
    context: unknown
  ): Promise<void> {
    await super.onSaveSettings(newSettings, oldSettings, context);
    await this.ignorePatternsComponent.reload(newSettings.settings.obsidianIgnoreContent);
    this.hadConfigChanges = true;
  }

  private addToFilesPane(normalizedPath: string): void {
    const fileExplorerView = this.getFileExplorerView();
    if (!fileExplorerView) {
      return;
    }

    if (fileExplorerView.fileItems[normalizedPath]) {
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!file) {
      return;
    }

    fileExplorerView.onCreate(file);
  }

  private deleteFromFilesPane(normalizedPath: string): void {
    const fileExplorerView = this.getFileExplorerView();
    if (!fileExplorerView) {
      return;
    }

    if (!fileExplorerView.fileItems[normalizedPath]) {
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!file) {
      return;
    }

    fileExplorerView.onDelete(file);
  }

  private generateReconcileWrapper(next: GenericReconcileFn, isFolder: boolean): GenericReconcileFn {
    return async (normalizedPath: string, ...args: unknown[]) => {
      let shouldRemoveFromFilesPane = false;
      if (await this.ignorePatternsComponent.isIgnored(normalizedPath, isFolder)) {
        if (this.settings.excludeMode === ExcludeMode.Full) {
          return;
        }
        shouldRemoveFromFilesPane = true;
      }
      await next.call(this.app.vault.adapter, normalizedPath, ...args);
      if (shouldRemoveFromFilesPane) {
        this.deleteFromFilesPane(normalizedPath);
      }
    };
  }

  private getFileExplorerView(): FileExplorerView | undefined {
    return this.app.workspace.getLeavesOfType('file-explorer')[0]?.view as FileExplorerView | undefined;
  }

  private isDotFile(path: string): boolean {
    return basename(path).startsWith('.');
  }

  private onCreate(next: OnCreateFn, view: FileExplorerView, file: TAbstractFile): void {
    if (this.settings.excludeMode !== ExcludeMode.FilesPane) {
      next.call(view, file);
      return;
    }

    invokeAsyncSafely(async () => {
      const isIgnored = await this.ignorePatternsComponent.isIgnored(file.path, isFolderFn(file));
      if (isIgnored) {
        return;
      }
      next.call(view, file);
    });
  }

  private async reconcileDeletion(
    next: DataAdapterReconcileDeletionFn,
    normalizedPath: string,
    normalizedNewPath: string,
    shouldSkipDeletionTimeout?: boolean
  ): Promise<void> {
    await next.call(this.app.vault.adapter, normalizedPath, normalizedNewPath, shouldSkipDeletionTimeout);
    if (!this.app.workspace.layoutReady) {
      return;
    }

    await this.ignorePatternsComponent.handleDeletedOrDotFile(normalizedPath);
  }

  private async reloadChildPath(childPath: string, orphanPaths: Set<string>, includedPaths: Set<string>, isFolder: boolean): Promise<void> {
    this.consoleDebug(`Reloading file: ${childPath}`);
    if (this.isDotFile(childPath)) {
      return;
    }

    orphanPaths.delete(childPath);

    const adapter = this.app.vault.adapter;

    const isChildPathIgnored = await this.ignorePatternsComponent.isIgnored(childPath, isFolder);
    if (isChildPathIgnored && this.settings.excludeMode === ExcludeMode.Full) {
      await adapter.reconcileDeletion(childPath, childPath);
      return;
    }

    if (adapter instanceof FileSystemAdapter) {
      await adapter.reconcileFileInternal(childPath, childPath);
    } else {
      await adapter.reconcileFile(childPath, childPath);
    }
    includedPaths.add(childPath);
    if (isChildPathIgnored) {
      this.deleteFromFilesPane(childPath);
    } else if (this.settings.excludeMode === ExcludeMode.FilesPane) {
      this.addToFilesPane(childPath);
    }
  }

  private async reloadFolder(folderPath: string, abortSignal: AbortSignal): Promise<void> {
    if (abortSignal.aborted) {
      return;
    }
    this.consoleDebug(`Reloading folder: ${folderPath}`);
    if (folderPath !== ROOT_PATH) {
      this.updateProgressEl.max++;
    }
    const folder = this.app.vault.getFolderByPath(folderPath);
    if (!folder) {
      this.updateProgressEl.value++;
      return;
    }

    const adapter = this.app.vault.adapter;
    if (folderPath === ROOT_PATH) {
      await adapter.reconcileFolderCreation(folderPath, folderPath);
    }

    const listedFiles = await adapter.list(folderPath);
    this.updateProgressEl.max += listedFiles.files.length + listedFiles.folders.length;

    const includedPaths = new Set<string>();

    const orphanPaths = new Set<string>(folder.children.map((child) => child.path));

    const childEntries = listedFiles.files.map((childFilePath) => ({ childPath: childFilePath, isFolder: false }))
      .concat(listedFiles.folders.map((childFolderPath) => ({ childPath: childFolderPath, isFolder: true })));

    for (const childEntry of childEntries) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (abortSignal.aborted) {
          return;
        }

        await this.reloadChildPath(childEntry.childPath, orphanPaths, includedPaths, childEntry.isFolder);
      } catch (e) {
        console.error(`Failed reloading file: ${childEntry.childPath}`, e);
      } finally {
        this.updateProgressEl.value++;
      }
    }

    this.updateProgressEl.max += orphanPaths.size;
    for (const orphanPath of orphanPaths) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (abortSignal.aborted) {
        return;
      }
      this.consoleDebug(`Cleaning orphan file: ${orphanPath}`);
      this.updateProgressEl.value++;
      try {
        await adapter.reconcileDeletion(orphanPath, orphanPath);
      } catch (e) {
        console.error(`Failed cleaning orphan file ${orphanPath}`, e);
      }
    }

    for (const childFolderPath of listedFiles.folders) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (abortSignal.aborted) {
        return;
      }
      if (includedPaths.has(childFolderPath)) {
        try {
          await this.reloadFolder(childFolderPath, abortSignal);
        } catch (e) {
          console.error(`Failed reloading folder ${childFolderPath}`, e);
        }
      }
    }

    this.updateProgressEl.value++;
  }

  private async vaultLoad(next: VaultLoadFn): Promise<void> {
    this.vaultLoadCalled = true;
    await next.call(this.app.vault);
  }
}
