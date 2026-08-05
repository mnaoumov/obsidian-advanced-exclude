import type { App } from 'obsidian';

import { MonkeyAroundComponent } from 'obsidian-dev-utils/obsidian/components/monkey-around-component';

import type { FileTreeComponent } from '../file-tree-component.ts';
import type { IgnorePatternsComponent } from '../ignore-patterns-component.ts';
import type { IndexProjectionComponent } from '../index-projection-component.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { ExcludeMode } from '../plugin-settings.ts';

export interface AdapterPatchBaseComponentConstructorParams {
  readonly app: App;
  readonly fileTreeComponent: FileTreeComponent;
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly indexProjectionComponent: IndexProjectionComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}
export type GenericReconcileFunction = (normalizedPath: string, ...arguments_: unknown[]) => Promise<void>;

export class AdapterPatchBaseComponent extends MonkeyAroundComponent {
  private readonly app: App;
  private readonly fileTreeComponent: FileTreeComponent;
  private readonly ignorePatternsComponent: IgnorePatternsComponent;
  private readonly indexProjectionComponent: IndexProjectionComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: AdapterPatchBaseComponentConstructorParams) {
    super();
    this.app = params.app;
    this.ignorePatternsComponent = params.ignorePatternsComponent;
    this.indexProjectionComponent = params.indexProjectionComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.fileTreeComponent = params.fileTreeComponent;
  }

  protected generateReconcileWrapper(originalFunction: GenericReconcileFunction, isFolder: boolean): GenericReconcileFunction {
    return async (normalizedPath: string, ...arguments_: unknown[]) => {
      this.indexProjectionComponent.recordCreate({ isFolderPath: isFolder, normalizedPath });
      let shouldRemoveFromFilesPane = false;
      if (this.ignorePatternsComponent.isIgnored({ isFolder, normalizedPath })) {
        if (this.pluginSettingsComponent.settings.excludeMode === ExcludeMode.Full) {
          return;
        }
        shouldRemoveFromFilesPane = true;
      }
      await originalFunction.call(this.app.vault.adapter, normalizedPath, ...arguments_);
      if (shouldRemoveFromFilesPane) {
        this.fileTreeComponent.deleteFromFilesPane(normalizedPath);
      }
    };
  }
}
