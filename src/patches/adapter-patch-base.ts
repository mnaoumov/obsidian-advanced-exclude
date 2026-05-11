import type { App } from 'obsidian';
import type { DataAdapterEx } from 'obsidian-typings';

import { Component } from 'obsidian';

import type { FileTreeComponent } from '../file-tree-component.ts';
import type { IgnorePatternsComponent } from '../ignore-patterns-component.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { ExcludeMode } from '../plugin-settings.ts';

export interface AdapterPatchBaseConstructorParams {
  readonly app: App;
  readonly fileTreeComponent: FileTreeComponent;
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}
export type DataAdapterReconcileDeletionFn = DataAdapterEx['reconcileDeletion'];
export type DataAdapterReconcileFolderCreationFn = DataAdapterEx['reconcileFolderCreation'];
export type GenericReconcileFn = (normalizedPath: string, ...args: unknown[]) => Promise<void>;

export class AdapterPatchBase extends Component {
  private readonly app: App;
  private readonly fileTreeComponent: FileTreeComponent;
  private readonly ignorePatternsComponent: IgnorePatternsComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: AdapterPatchBaseConstructorParams) {
    super();
    this.app = params.app;
    this.ignorePatternsComponent = params.ignorePatternsComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.fileTreeComponent = params.fileTreeComponent;
  }

  protected generateReconcileWrapper(next: GenericReconcileFn, isFolder: boolean): GenericReconcileFn {
    return async (normalizedPath: string, ...args: unknown[]) => {
      let shouldRemoveFromFilesPane = false;
      if (this.ignorePatternsComponent.isIgnored(normalizedPath, isFolder)) {
        if (this.pluginSettingsComponent.settings.excludeMode === ExcludeMode.Full) {
          return;
        }
        shouldRemoveFromFilesPane = true;
      }
      await next.call(this.app.vault.adapter, normalizedPath, ...args);
      if (shouldRemoveFromFilesPane) {
        this.fileTreeComponent.deleteFromFilesPane(normalizedPath);
      }
    };
  }

  protected async reconcileDeletion(
    next: DataAdapterReconcileDeletionFn,
    normalizedPath: string,
    normalizedNewPath: string,
    shouldSkipDeletionTimeout?: boolean
  ): Promise<void> {
    await next.call(this.app.vault.adapter, normalizedPath, normalizedNewPath, shouldSkipDeletionTimeout);
    if (!this.app.workspace.layoutReady) {
      return;
    }

    await this.ignorePatternsComponent.handleDeletedOrDotFile(normalizedPath);
  }
}
