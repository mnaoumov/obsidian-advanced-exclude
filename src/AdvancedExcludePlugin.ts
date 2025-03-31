import type { DataAdapter } from 'obsidian';

import {
  CapacitorAdapter,
  FileSystemAdapter,
  PluginSettingTab
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';
import { registerPatch } from 'obsidian-dev-utils/obsidian/MonkeyAround';
import { PluginBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginBase';
import { basename } from 'obsidian-dev-utils/Path';

import { AdvancedExcludePluginSettings } from './AdvancedExcludePluginSettings.ts';
import { AdvancedExcludePluginSettingsTab } from './AdvancedExcludePluginSettingsTab.ts';
import {
  clearCachedExcludeRegExps,
  isIgnoreConfigFileChanged,
  isIgnored,
  ROOT_PATH
} from './IgnorePatterns.ts';

type CapacitorAdapterReconcileFileCreationFn = CapacitorAdapter['reconcileFileCreation'];
type DataAdapterReconcileDeletionFn = DataAdapter['reconcileDeletion'];
type DataAdapterReconcileFolderCreationFn = DataAdapter['reconcileFolderCreation'];
type FileSystemAdapterReconcileFileCreationFn = FileSystemAdapter['reconcileFileCreation'];

type GenericReconcileFn = (normalizedPath: string, ...args: unknown[]) => Promise<void>;

export class AdvancedExcludePlugin extends PluginBase<AdvancedExcludePluginSettings> {
  private updateProgressEl!: HTMLProgressElement;
  protected override createPluginSettings(data: unknown): AdvancedExcludePluginSettings {
    return new AdvancedExcludePluginSettings(data);
  }

  protected override createPluginSettingsTab(): null | PluginSettingTab {
    return new AdvancedExcludePluginSettingsTab(this);
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

  private async reloadFolder(folderPath: string): Promise<void> {
    this.updateProgressEl.max++;
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
      this.updateProgressEl.value++;
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

    this.updateProgressEl.max += orphanPaths.size;
    for (const orphanPath of orphanPaths) {
      this.updateProgressEl.value++;
      await adapter.reconcileDeletion(orphanPath, orphanPath);
    }

    for (const childFolderPath of listedFiles.folders) {
      if (includedPaths.has(childFolderPath)) {
        await this.reloadFolder(childFolderPath);
      }
    }

    this.updateProgressEl.value++;
  }

  private async updateFileTree(): Promise<void> {
    const fragment = createFragment((f) => {
      f.appendText('Advanced Exclude: Updating file tree...');
      this.updateProgressEl = f.createEl('progress');
    });
    const notice = new Notice(fragment, 0);
    await this.reloadFolder(ROOT_PATH);
    notice.hide();
  }
}
