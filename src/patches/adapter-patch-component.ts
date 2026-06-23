import type { App } from 'obsidian';

import { getDataAdapterEx } from '@obsidian-typings/obsidian-public-latest/implementations';
import {
  CapacitorAdapter,
  FileSystemAdapter
} from 'obsidian';
import { MonkeyAroundComponent } from 'obsidian-dev-utils/obsidian/components/monkey-around-component';

import type { FileTreeComponent } from '../file-tree-component.ts';
import type { IgnorePatternsComponent } from '../ignore-patterns-component.ts';
import type { IndexProjectionComponent } from '../index-projection-component.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { CapacitorAdapterPatchComponent } from './capacitor-adapter-patch-component.ts';
import { FileSystemAdapterPatchComponent } from './file-system-adapter-patch-component.ts';

export interface AdapterPatchComponentConstructorParams {
  readonly app: App;
  readonly fileTreeComponent: FileTreeComponent;
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly indexProjectionComponent: IndexProjectionComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

export class AdapterPatchComponent extends MonkeyAroundComponent {
  private readonly app: App;
  private readonly fileTreeComponent: FileTreeComponent;
  private readonly ignorePatternsComponent: IgnorePatternsComponent;
  private readonly indexProjectionComponent: IndexProjectionComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: AdapterPatchComponentConstructorParams) {
    super();
    this.app = params.app;
    this.ignorePatternsComponent = params.ignorePatternsComponent;
    this.indexProjectionComponent = params.indexProjectionComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.fileTreeComponent = params.fileTreeComponent;
  }

  public override onload(): void {
    this.registerMethodPatch({
      methodName: 'reconcileDeletion',
      obj: getDataAdapterEx(this.app),
      patchHandler: ({
        fallback,
        originalArgs: [normalizedPath]
      }) => {
        return this.reconcileDeletion(fallback, normalizedPath);
      }
    });

    if (this.app.vault.adapter instanceof FileSystemAdapter) {
      this.addChild(
        new FileSystemAdapterPatchComponent({
          adapter: this.app.vault.adapter,
          app: this.app,
          fileTreeComponent: this.fileTreeComponent,
          ignorePatternsComponent: this.ignorePatternsComponent,
          indexProjectionComponent: this.indexProjectionComponent,
          pluginSettingsComponent: this.pluginSettingsComponent
        })
      );
    } else if (this.app.vault.adapter instanceof CapacitorAdapter) {
      this.addChild(
        new CapacitorAdapterPatchComponent({
          adapter: this.app.vault.adapter,
          app: this.app,
          fileTreeComponent: this.fileTreeComponent,
          ignorePatternsComponent: this.ignorePatternsComponent,
          indexProjectionComponent: this.indexProjectionComponent,
          pluginSettingsComponent: this.pluginSettingsComponent
        })
      );
    }
  }

  protected async reconcileDeletion(fallback: () => Promise<void>, normalizedPath: string): Promise<void> {
    await fallback();
    if (!this.app.workspace.layoutReady) {
      return;
    }

    // While a projection is applying, ignore reconcileDeletion: it is not a real on-disk
    // Deletion to record, and recording it would forget paths the projection is managing.
    if (this.indexProjectionComponent.isApplyingProjection) {
      return;
    }

    this.indexProjectionComponent.recordDelete(normalizedPath);
    await this.ignorePatternsComponent.handleDeletedOrDotFile(normalizedPath);
  }
}
