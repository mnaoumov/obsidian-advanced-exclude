import type { DataAdapter } from 'obsidian';

import {
  CapacitorAdapter,
  FileSystemAdapter
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

  protected override createPluginSettingsTab(): null | PluginSettingsTab {
    return new PluginSettingsTab(this);
  }

  protected override createSettingsManager(): PluginSettingsManager {
    return new PluginSettingsManager(this);
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

  private generateReconcileWrapper(next: GenericReconcileFn): GenericReconcileFn {
    return async (normalizedPath: string, ...args: unknown[]) => {
      if (await isIgnored(normalizedPath, this)) {
        return;
      }
      await next.call(this.app.vault.adapter, normalizedPath, ...args);
    };
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
        this.consoleDebug(`Reloading file: ${childPath}`);
        if (this.isDotFile(childPath)) {
          continue;
        }

        orphanPaths.delete(childPath);

        const isChildPathIgnored = await isIgnored(childPath, this);
        if (isChildPathIgnored) {
          await adapter.reconcileDeletion(childPath, childPath);
        } else {
          if (adapter instanceof FileSystemAdapter) {
            await adapter.reconcileFileInternal(childPath, childPath);
          } else {
            await adapter.reconcileFile(childPath, childPath);
          }
          includedPaths.add(childPath);
        }
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
