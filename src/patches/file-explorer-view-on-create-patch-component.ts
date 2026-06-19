import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';

import {
  App,
  TAbstractFile
} from 'obsidian';
import { getPrototypeOf } from 'obsidian-dev-utils/object-utils';
import { CallbackLayoutReadyComponent } from 'obsidian-dev-utils/obsidian/components/layout-ready-component';
import { MonkeyAroundComponent } from 'obsidian-dev-utils/obsidian/components/monkey-around-component';
import { isFolder as isFolderFn } from 'obsidian-dev-utils/obsidian/file-system';

import type { IgnorePatternsComponent } from '../ignore-patterns-component.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { ExcludeMode } from '../plugin-settings.ts';

interface FileExplorerViewOnCreatePatchComponentConstructorParams {
  readonly app: App;
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

type OnCreateFn = FileExplorerView['onCreate'];

export class FileExplorerViewOnCreatePatchComponent extends MonkeyAroundComponent {
  private readonly app: App;
  private readonly ignorePatternsComponent: IgnorePatternsComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: FileExplorerViewOnCreatePatchComponentConstructorParams) {
    super();
    this.app = params.app;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.ignorePatternsComponent = params.ignorePatternsComponent;
  }

  public onLayoutReady(): void {
    const view = this.getFileExplorerView();
    if (view) {
      this.registerMethodPatch({
        methodName: 'onCreate',
        obj: getPrototypeOf(view),
        patchHandler: ({
          originalArgs: [file],
          originalMethod,
          originalThis
        }) => {
          this.onCreate(originalMethod, originalThis, file);
        }
      });
    }
  }

  public override onload(): void {
    this.addChild(new CallbackLayoutReadyComponent(this.app, this.onLayoutReady.bind(this)));
  }

  private getFileExplorerView(): FileExplorerView | undefined {
    return this.app.workspace.getLeavesOfType('file-explorer')[0]?.view as FileExplorerView | undefined;
  }

  private onCreate(originalFn: OnCreateFn, view: FileExplorerView, file: TAbstractFile): void {
    if (this.pluginSettingsComponent.settings.excludeMode !== ExcludeMode.FilesPane) {
      originalFn.call(view, file);
      return;
    }

    const isIgnored = this.ignorePatternsComponent.isIgnored(file.path, isFolderFn(file));
    if (isIgnored) {
      return;
    }
    originalFn.call(view, file);
  }
}
