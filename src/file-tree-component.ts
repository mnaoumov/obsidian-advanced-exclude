import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';
import type { App } from 'obsidian';

import { ComponentEx } from '@mnaoumov/obsidian-lib/components/component-ex';
import { ViewType } from '@obsidian-typings/obsidian-public-latest/implementations';

interface FileTreeComponentConstructorParams {
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
    if (!fileExplorerView || Object.hasOwn(fileExplorerView.fileItems, normalizedPath)) {
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
    if (!fileExplorerView || !Object.hasOwn(fileExplorerView.fileItems, normalizedPath)) {
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!file) {
      return;
    }

    fileExplorerView.onDelete(file);
  }

  private getFileExplorerView(): FileExplorerView | undefined {
    const view = this.app.workspace.getLeavesOfType(ViewType.FileExplorer)[0]?.view;
    return view && 'fileItems' in view ? view : undefined;
  }
}
