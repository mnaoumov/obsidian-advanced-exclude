import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';

import { CallbackLayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import { MonkeyAroundComponent } from '@mnaoumov/obsidian-lib/components/monkey-around-component';
import { isFolder as isFolderFunction } from '@mnaoumov/obsidian-lib/file-system';
import { getPrototypeOf } from '@mnaoumov/typescript-lib/object-utils';
import { ViewType } from '@obsidian-typings/obsidian-public-latest/implementations';
import {
  App,
  TAbstractFile
} from 'obsidian';

import type { IgnorePatternsComponent } from '../ignore-patterns-component.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { ExcludeMode } from '../plugin-settings.ts';

interface FileExplorerViewOnCreatePatchComponentConstructorParams {
  readonly app: App;
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

type OnCreateFunction = FileExplorerView['onCreate'];

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
    if (this.tryPatch()) {
      return;
    }
    // A deferred explorer leaf has no real view yet, and the prototype is reachable only through an
    // instance, so retry once one is built.
    const layoutChangeEventRef = this.app.workspace.on('layout-change', () => {
      if (this.tryPatch()) {
        this.app.workspace.offref(layoutChangeEventRef);
      }
    });
    this.registerEvent(layoutChangeEventRef);
  }

  public override onload(): void {
    this.addChild(new CallbackLayoutReadyComponent(this.app, this.onLayoutReady.bind(this)));
  }

  private getFileExplorerView(): FileExplorerView | undefined {
    const view = this.app.workspace.getLeavesOfType(ViewType.FileExplorer)[0]?.view;
    return view && 'fileItems' in view ? view : undefined;
  }

  private onCreate(originalFunction: OnCreateFunction, view: FileExplorerView, file: TAbstractFile): void {
    if (this.pluginSettingsComponent.settings.excludeMode !== ExcludeMode.FilesPane) {
      originalFunction.call(view, file);
      return;
    }

    const isIgnored = this.ignorePatternsComponent.isIgnored({ isFolder: isFolderFunction(file), normalizedPath: file.path });
    if (isIgnored) {
      return;
    }
    originalFunction.call(view, file);
  }

  private tryPatch(): boolean {
    const view = this.getFileExplorerView();
    if (!view) {
      return false;
    }
    this.registerMethodPatch({
      $object: getPrototypeOf(view),
      methodName: 'onCreate',
      patchHandler: ({
        originalArguments: [file],
        originalMethod,
        originalThis
      }) => {
        this.onCreate(originalMethod, originalThis, file);
      }
    });
    return true;
  }
}
