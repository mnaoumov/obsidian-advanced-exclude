import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';
import type { App } from 'obsidian';

import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';

export interface FileTreeComponentConstructorParams {
  readonly app: App;
}

/**
 * Owns the file-explorer pane operations used by the index projection (in
 * `FilesPane` mode) and by the adapter patches.
 */
export class FileTreeComponent extends ComponentEx {
  private readonly app: App;

  public constructor(params: FileTreeComponentConstructorParams) {
    super();
    this.app = params.app;
  }

  public addToFilesPane(normalizedPath: string): void {
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

  private getFileExplorerView(): FileExplorerView | undefined {
    return this.app.workspace.getLeavesOfType('file-explorer')[0]?.view as FileExplorerView | undefined;
  }
}
