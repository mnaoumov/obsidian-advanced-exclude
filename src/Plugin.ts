import type { DataAdapter } from 'obsidian';
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
import { registerPatch } from 'obsidian-dev-utils/obsidian/MonkeyAround';
import { PluginBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginBase';
import { basename } from 'obsidian-dev-utils/Path';

import type { PluginTypes } from './PluginTypes.ts';

import {
  clearCachedExcludeRegExps,
  isIgnoreConfigFileChanged,
  isIgnored,
  ROOT_PATH
} from './IgnorePatterns.ts';
import { ExcludeMode } from './PluginSettings.ts';
import { PluginSettingsManager } from './PluginSettingsManager.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';

type CapacitorAdapterReconcileFileCreationFn = CapacitorAdapter['reconcileFileCreation'];
type DataAdapterReconcileDeletionFn = DataAdapter['reconcileDeletion'];
type DataAdapterReconcileFolderCreationFn = DataAdapter['reconcileFolderCreation'];
type FileSystemAdapterReconcileFileCreationFn = FileSystemAdapter['reconcileFileCreation'];

type GenericReconcileFn = (normalizedPath: string, ...args: unknown[]) => Promise<void>;

export class Plugin extends PluginBase<PluginTypes> {
  private updateFileTreeAbortController: AbortController | null = null;
  private updateProgressEl!: HTMLProgressElement;

  protected override createSettingsManager(): PluginSettingsManager {
    return new PluginSettingsManager(this);
  }

  protected override createSettingsTab(): null | PluginSettingsTab {
    return new PluginSettingsTab(this);
  }

  protected override async onLayoutReady(): Promise<void> {
    this.registerEvent(this.app.vault.on('config-changed', (configKey: string) => {
      if (configKey === 'userIgnoreFilters') {
        clearCachedExcludeRegExps();
      }
    }));

    if (this.app.vault.adapter instanceof CapacitorAdapter) {
      registerPatch(this, this.app.vault.adapter, {
        reconcileDeletion: (next: DataAdapterReconcileDeletionFn): DataAdapterReconcileDeletionFn => {
          return async (normalizedPath: string, normalizedNewPath: string, shouldSkipDeletionTimeout?: boolean): Promise<void> => {
            return this.reconcileDeletion(next, normalizedPath, normalizedNewPath, shouldSkipDeletionTimeout);
          };
        },
        reconcileFileCreation: (next: CapacitorAdapterReconcileFileCreationFn): CapacitorAdapterReconcileFileCreationFn =>
          this.generateReconcileWrapper(next as GenericReconcileFn),
        reconcileFolderCreation: (next: DataAdapterReconcileFolderCreationFn): DataAdapterReconcileFolderCreationFn =>
          this.generateReconcileWrapper(next as GenericReconcileFn)
      });
    } else if (this.app.vault.adapter instanceof FileSystemAdapter) {
      registerPatch(this, this.app.vault.adapter, {
        reconcileDeletion: (next: DataAdapterReconcileDeletionFn): DataAdapterReconcileDeletionFn => {
          return async (normalizedPath: string, normalizedNewPath: string, shouldSkipDeletionTimeout?: boolean): Promise<void> => {
            return this.reconcileDeletion(next, normalizedPath, normalizedNewPath, shouldSkipDeletionTimeout);
          };
        },
        reconcileFileCreation: (next: FileSystemAdapterReconcileFileCreationFn): FileSystemAdapterReconcileFileCreationFn =>
          this.generateReconcileWrapper(next as GenericReconcileFn),
        reconcileFolderCreation: (next: DataAdapterReconcileFolderCreationFn): DataAdapterReconcileFolderCreationFn =>
          this.generateReconcileWrapper(next as GenericReconcileFn)
      });
    }

    this.register(() => {
      invokeAsyncSafely(() => this.updateFileTree());
    });

    await this.updateFileTree();
  }

  protected override async onSaveSettings(
    newSettings: ReadonlyObjectDeep<ExtractPluginSettingsWrapper<PluginTypes>>,
    oldSettings: ReadonlyObjectDeep<ExtractPluginSettingsWrapper<PluginTypes>>,
    _context: unknown
  ): Promise<void> {
    if (newSettings.settings.excludeMode !== oldSettings.settings.excludeMode) {
      await this.updateFileTree();
    }
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

  private generateReconcileWrapper(next: GenericReconcileFn): GenericReconcileFn {
    return async (normalizedPath: string, ...args: unknown[]) => {
      let shouldRemoveFromFilesPane = false;
      if (await isIgnored(normalizedPath, this)) {
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

  private async reconcileDeletion(
    next: DataAdapterReconcileDeletionFn,
    normalizedPath: string,
    normalizedNewPath: string,
    shouldSkipDeletionTimeout?: boolean
  ): Promise<void> {
    await next.call(this.app.vault.adapter, normalizedPath, normalizedNewPath, shouldSkipDeletionTimeout);
    if (this.app.workspace.layoutReady && await isIgnoreConfigFileChanged(this, normalizedPath)) {
      invokeAsyncSafely(() => this.updateFileTree());
    }
  }

  private async reloadChildPath(childPath: string, orphanPaths: Set<string>, includedPaths: Set<string>): Promise<void> {
    this.consoleDebug(`Reloading file: ${childPath}`);
    if (this.isDotFile(childPath)) {
      return;
    }

    orphanPaths.delete(childPath);

    const adapter = this.app.vault.adapter;

    const isChildPathIgnored = await isIgnored(childPath, this);
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

    for (const childPath of listedFiles.files.concat(listedFiles.folders)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (abortSignal.aborted) {
          return;
        }

        await this.reloadChildPath(childPath, orphanPaths, includedPaths);
      } catch (e) {
        console.error(`Failed reloading file: ${childPath}`, e);
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

  private async updateFileTree(): Promise<void> {
    const NOTIFICATION_MIN_DURATION_IN_MS = 2000;

    if (this.updateFileTreeAbortController) {
      this.updateFileTreeAbortController.abort();
    }

    this.updateFileTreeAbortController = new AbortController();
    const abortSignal = AbortSignal.any([this.updateFileTreeAbortController.signal, this.abortSignal]);
    const fragment = createFragment((f) => {
      f.appendText('Advanced Exclude: Updating file tree...');
      this.updateProgressEl = f.createEl('progress');
    });
    const notice = new Notice(fragment, 0);
    try {
      await Promise.race([
        Promise.all([this.reloadFolder(ROOT_PATH, abortSignal), sleep(NOTIFICATION_MIN_DURATION_IN_MS)]),
        ignoreError(throwOnAbort(abortSignal))
      ]);
    } finally {
      notice.hide();
      this.updateFileTreeAbortController = null;
    }
  }
}
