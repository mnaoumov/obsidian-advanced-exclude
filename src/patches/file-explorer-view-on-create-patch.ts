import type { LayoutReadyComponent } from 'obsidian-dev-utils/obsidian/components/layout-ready-component';
import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';

import {
  App,
  Component,
  TAbstractFile
} from 'obsidian';
import { getPrototypeOf } from 'obsidian-dev-utils/object-utils';
import { isFolder as isFolderFn } from 'obsidian-dev-utils/obsidian/file-system';
import { registerPatch } from 'obsidian-dev-utils/obsidian/monkey-around';

import type { IgnorePatternsComponent } from '../ignore-patterns-component.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { ExcludeMode } from '../plugin-settings.ts';

interface FileExplorerViewOnCreateConstructorParams {
  readonly app: App;
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

type OnCreateFn = FileExplorerView['onCreate'];

export class FileExplorerViewOnCreatePatch extends Component implements LayoutReadyComponent {
  private readonly app: App;
  private readonly ignorePatternsComponent: IgnorePatternsComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: FileExplorerViewOnCreateConstructorParams) {
    super();
    this.app = params.app;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.ignorePatternsComponent = params.ignorePatternsComponent;
  }

  public onLayoutReady(): void {
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

  private getFileExplorerView(): FileExplorerView | undefined {
    return this.app.workspace.getLeavesOfType('file-explorer')[0]?.view as FileExplorerView | undefined;
  }

  private onCreate(next: OnCreateFn, view: FileExplorerView, file: TAbstractFile): void {
    if (this.pluginSettingsComponent.settings.excludeMode !== ExcludeMode.FilesPane) {
      next.call(view, file);
      return;
    }

    const isIgnored = this.ignorePatternsComponent.isIgnored(file.path, isFolderFn(file));
    if (isIgnored) {
      return;
    }
    next.call(view, file);
  }
}
