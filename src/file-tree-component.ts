import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';
import type { App } from 'obsidian';

import { ComponentEx } from '@mnaoumov/obsidian-lib/components/component-ex';
import { CallbackLayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import { ViewType } from '@obsidian-typings/obsidian-public-latest/implementations';

interface FileTreeComponentConstructorParams {
  readonly app: App;
  /**
   * Called when a file explorer view is built after layout ready (a deferred explorer leaf
   * revealed for the first time, or a new explorer opened). Such a view lists every loaded
   * file, so the hidden set has to be removed from it again.
   */
  readonly onFileExplorerViewBuilt: (this: void) => void;
}

/**
 * Owns the file-explorer pane operations used by the index projection (in
 * `FilesPane` mode) and by the adapter patches.
 */
export class FileTreeComponent extends ComponentEx {
  private readonly app: App;
  private readonly knownFileExplorerViews = new WeakSet<FileExplorerView>();
  private readonly onFileExplorerViewBuilt: () => void;

  public constructor(params: FileTreeComponentConstructorParams) {
    super();
    this.app = params.app;
    this.onFileExplorerViewBuilt = params.onFileExplorerViewBuilt;
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

  public override onload(): void {
    this.addChild(new CallbackLayoutReadyComponent(this.app, this.onLayoutReady.bind(this)));
  }

  private getFileExplorerView(): FileExplorerView | undefined {
    const view = this.app.workspace.getLeavesOfType(ViewType.FileExplorer)[0]?.view;
    return view && 'fileItems' in view ? view : undefined;
  }

  private onLayoutChange(): void {
    const fileExplorerView = this.getFileExplorerView();
    if (!fileExplorerView || this.knownFileExplorerViews.has(fileExplorerView)) {
      return;
    }
    this.knownFileExplorerViews.add(fileExplorerView);
    this.onFileExplorerViewBuilt();
  }

  private onLayoutReady(): void {
    // The explorer that exists at layout ready is the projection's own `onLayoutReady` concern, so
    // it is only recorded here; a view that appears later is reported on the next layout change.
    const fileExplorerView = this.getFileExplorerView();
    if (fileExplorerView) {
      this.knownFileExplorerViews.add(fileExplorerView);
    }
    this.registerEvent(this.app.workspace.on('layout-change', this.onLayoutChange.bind(this)));
  }
}
