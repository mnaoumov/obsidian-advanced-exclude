import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';
import type { App } from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';

import { getDataAdapterEx } from '@obsidian-typings/obsidian-public-latest/implementations';
import { FileSystemAdapter } from 'obsidian';
import { sleep } from 'obsidian-dev-utils/async';
import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';
import { CallbackLayoutReadyComponent } from 'obsidian-dev-utils/obsidian/components/layout-ready-component';
import { basename } from 'obsidian-dev-utils/path';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import type { VaultLoadPatchComponent } from './patches/vault-load-patch-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { ROOT_PATH } from './constants.ts';
import { ExcludeMode } from './plugin-settings.ts';

interface FileTreeComponentConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly vaultLoadPatch: VaultLoadPatchComponent;
}

export class FileTreeComponent extends ComponentEx {
  private _updateProgressEl?: HTMLProgressElement;
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private hadConfigChanges = false;
  private readonly ignorePatternsComponent: IgnorePatternsComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private updateFileTreeAbortController: AbortController | null = null;

  private readonly vaultLoadPatch: VaultLoadPatchComponent;

  private get updateProgressEl(): HTMLProgressElement {
    return ensureNonNullable(this._updateProgressEl);
  }

  public constructor(params: FileTreeComponentConstructorParams) {
    super();
    this.app = params.app;
    this.vaultLoadPatch = params.vaultLoadPatch;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.ignorePatternsComponent = params.ignorePatternsComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  public deleteFromFilesPane(normalizedPath: string): void {
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

  public async onLayoutReady(): Promise<void> {
    if (!this.vaultLoadPatch.vaultLoadCalled) {
      await this.update();
    }
  }

  public override async onloadAsync(): Promise<void> {
    await this.update();
    this.addChild(new CallbackLayoutReadyComponent(this.app, this.onLayoutReady.bind(this)));
  }

  public async processConfigChanges(): Promise<void> {
    if (!this.hadConfigChanges) {
      return;
    }

    this.hadConfigChanges = false;
    await this.ignorePatternsComponent.processConfigChanges();
  }

  public async update(): Promise<void> {
    const NOTIFICATION_MIN_DURATION_IN_MS = 2000;

    if (this.updateFileTreeAbortController) {
      this.updateFileTreeAbortController.abort();
    }

    this.updateFileTreeAbortController = new AbortController();
    const abortSignal = this.updateFileTreeAbortController.signal;
    const fragment = createFragment((f) => {
      f.appendText('Advanced Exclude: Updating file tree...');
      this._updateProgressEl = f.createEl('progress');
    });
    const notice = new Notice(fragment, 0);
    try {
      await Promise.race([
        Promise.all([this.reloadFolder(ROOT_PATH, abortSignal), sleep(NOTIFICATION_MIN_DURATION_IN_MS, abortSignal)])
      ]);
    } finally {
      notice.hide();
      this.updateFileTreeAbortController = null;
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

  private getFileExplorerView(): FileExplorerView | undefined {
    return this.app.workspace.getLeavesOfType('file-explorer')[0]?.view as FileExplorerView | undefined;
  }

  private isDotFile(path: string): boolean {
    return basename(path).startsWith('.');
  }

  private async reloadChildPath(childPath: string, orphanPaths: Set<string>, includedPaths: Set<string>, isFolder: boolean): Promise<void> {
    this.consoleDebugComponent.debug(`Reloading file: ${childPath}`);
    if (this.isDotFile(childPath)) {
      return;
    }

    orphanPaths.delete(childPath);

    const adapter = getDataAdapterEx(this.app);

    const isChildPathIgnored = this.ignorePatternsComponent.isIgnored(childPath, isFolder);
    if (isChildPathIgnored && this.pluginSettingsComponent.settings.excludeMode === ExcludeMode.Full) {
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
    } else if (this.pluginSettingsComponent.settings.excludeMode === ExcludeMode.FilesPane) {
      this.addToFilesPane(childPath);
    }
  }

  private async reloadFolder(folderPath: string, abortSignal: AbortSignal): Promise<void> {
    /* v8 ignore start -- Defensive guard; callers check abortSignal.aborted before invoking reloadFolder synchronously. */
    if (abortSignal.aborted) {
      return;
    }
    /* v8 ignore stop */
    this.consoleDebugComponent.debug(`Reloading folder: ${folderPath}`);
    if (folderPath !== ROOT_PATH) {
      this.updateProgressEl.max++;
    }
    const folder = this.app.vault.getFolderByPath(folderPath);
    if (!folder) {
      this.updateProgressEl.value++;
      return;
    }

    const adapter = getDataAdapterEx(this.app);
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
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Can change in await calls.
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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Can change in await calls.
      if (abortSignal.aborted) {
        return;
      }
      this.consoleDebugComponent.debug(`Cleaning orphan file: ${orphanPath}`);
      this.updateProgressEl.value++;
      try {
        await adapter.reconcileDeletion(orphanPath, orphanPath);
      } catch (e) {
        console.error(`Failed cleaning orphan file ${orphanPath}`, e);
      }
    }

    for (const childFolderPath of listedFiles.folders) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Can change in await calls.
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
}
