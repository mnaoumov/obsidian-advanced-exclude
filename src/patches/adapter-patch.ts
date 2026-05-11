import type { App } from 'obsidian';

import {
  CapacitorAdapter,
  Component,
  FileSystemAdapter
} from 'obsidian';

import type { FileTreeComponent } from '../file-tree-component.ts';
import type { IgnorePatternsComponent } from '../ignore-patterns-component.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { CapacitorAdapterPatch } from './capacitor-adapter-patch.ts';
import { FileSystemAdapterPatch } from './file-system-adapter-patch.ts';

export interface AdapterPatchConstructorParams {
  readonly app: App;
  readonly fileTreeComponent: FileTreeComponent;
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

export class AdapterPatch extends Component {
  private readonly app: App;
  private readonly fileTreeComponent: FileTreeComponent;
  private readonly ignorePatternsComponent: IgnorePatternsComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: AdapterPatchConstructorParams) {
    super();
    this.app = params.app;
    this.ignorePatternsComponent = params.ignorePatternsComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.fileTreeComponent = params.fileTreeComponent;
  }

  public override onload(): void {
    super.onload();
    if (this.app.vault.adapter instanceof FileSystemAdapter) {
      this.addChild(
        new FileSystemAdapterPatch({
          adapter: this.app.vault.adapter,
          app: this.app,
          fileTreeComponent: this.fileTreeComponent,
          ignorePatternsComponent: this.ignorePatternsComponent,
          pluginSettingsComponent: this.pluginSettingsComponent
        })
      );
    } else if (this.app.vault.adapter instanceof CapacitorAdapter) {
      this.addChild(
        new CapacitorAdapterPatch({
          adapter: this.app.vault.adapter,
          app: this.app,
          fileTreeComponent: this.fileTreeComponent,
          ignorePatternsComponent: this.ignorePatternsComponent,
          pluginSettingsComponent: this.pluginSettingsComponent
        })
      );
    }
  }
}
