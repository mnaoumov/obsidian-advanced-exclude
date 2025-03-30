import type { DataAdapter } from 'obsidian';

import {
  CapacitorAdapter,
  FileSystemAdapter,
  PluginSettingTab
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';
import { around } from 'obsidian-dev-utils/obsidian/MonkeyAround';
import { PluginBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginBase';
import { basename } from 'obsidian-dev-utils/Path';

import { AdvancedExcludePluginSettings } from './AdvancedExcludePluginSettings.ts';
import { AdvancedExcludePluginSettingsTab } from './AdvancedExcludePluginSettingsTab.ts';
import {
  clearCachedExcludeRegExps,
  isIgnored,
  isObsidianIgnoreFileChanged,
  OBSIDIAN_IGNORE_FILE,
  ROOT_PATH
} from './IgnorePatterns.ts';

type CapacitorAdapterReconcileFileCreationFn = CapacitorAdapter['reconcileFileCreation'];
type DataAdapterReconcileDeletionFn = DataAdapter['reconcileDeletion'];
type DataAdapterReconcileFolderCreationFn = DataAdapter['reconcileFolderCreation'];
type FileSystemAdapterReconcileFileCreationFn = FileSystemAdapter['reconcileFileCreation'];

type GenericReconcileFn = (normalizedPath: string, ...args: unknown[]) => Promise<void>;

export class AdvancedExcludePlugin extends PluginBase<AdvancedExcludePluginSettings> {
  public async updateFileTree(): Promise<void> {
    await this.reloadFolder(ROOT_PATH);
  }

  protected override createPluginSettings(data: unknown): AdvancedExcludePluginSettings {
    return new AdvancedExcludePluginSettings(data);
  }

  protected override createPluginSettingsTab(): null | PluginSettingTab {
    return new AdvancedExcludePluginSettingsTab(this);
  }

  protected override async onLayoutReady(): Promise<void> {
    // Await updateFileTree(this);
  }

  protected override onloadComplete(): void {
    this.registerEvent(this.app.vault.on('config-changed', (configKey: string) => {
      if (configKey === 'userIgnoreFilters') {
        clearCachedExcludeRegExps();
      }
    }));

    if (this.app.vault.adapter instanceof CapacitorAdapter) {
      around(this.app.vault.adapter, {
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
      around(this.app.vault.adapter, {
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
    if (normalizedNewPath === OBSIDIAN_IGNORE_FILE && this.app.workspace.layoutReady && await isObsidianIgnoreFileChanged(this.app)) {
      invokeAsyncSafely(() => this.updateFileTree());
    }
  }

  private async reloadFolder(folderPath: string): Promise<void> {
    const folder = this.app.vault.getFolderByPath(folderPath);
    if (!folder) {
      return;
    }

    const adapter = this.app.vault.adapter;
    if (folderPath === ROOT_PATH) {
      await adapter.reconcileFolderCreation(folderPath, folderPath);
    }

    const listedFiles = await adapter.list(folderPath);

    const includedPaths = new Set<string>();

    const orphanPaths = new Set<string>(folder.children.map((child) => child.path));

    for (const childPath of listedFiles.files.concat(listedFiles.folders)) {
      if (this.isDotFile(childPath)) {
        continue;
      }

      orphanPaths.delete(childPath);

      const isChildPathIgnored = await isIgnored(childPath, this);
      if (isChildPathIgnored) {
        await adapter.reconcileDeletion(childPath, childPath);
      } else {
        await adapter.reconcileFile(childPath, childPath);
        includedPaths.add(childPath);
      }
    }

    for (const orphanPath of orphanPaths) {
      await adapter.reconcileDeletion(orphanPath, orphanPath);
    }

    for (const childFolderPath of listedFiles.folders) {
      if (includedPaths.has(childFolderPath)) {
        await this.reloadFolder(childFolderPath);
      }
    }
  }
}
