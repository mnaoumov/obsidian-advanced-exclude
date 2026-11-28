import type { App } from 'obsidian';

import { isFolder } from '@mnaoumov/obsidian-lib/file-system';
import { normalizePath } from 'obsidian';

import type { IgnorePatternsComponent } from '../patterns/ignore-patterns-component.ts';
import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';
import type { SoftExcludePatchComponent } from '../soft-exclude/soft-exclude-patch-component.ts';
import type { PathExplanation } from './path-explanation.ts';

import { ROOT_PATH } from '../constants.ts';

export interface PathExplainerConstructorParams {
  readonly app: App;
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly softExcludePatchComponent: SoftExcludePatchComponent;
}

/**
 * Explains why a path is excluded, or not, from the matchers the plugin decides with.
 */
export class PathExplainer {
  private readonly app: App;
  private readonly ignorePatternsComponent: IgnorePatternsComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly softExcludePatchComponent: SoftExcludePatchComponent;

  public constructor(params: PathExplainerConstructorParams) {
    this.app = params.app;
    this.ignorePatternsComponent = params.ignorePatternsComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.softExcludePatchComponent = params.softExcludePatchComponent;
  }

  /**
   * @returns The explanation for one normalized vault path.
   */
  public explain(normalizedPath: string, isFolderPath: boolean): PathExplanation {
    return {
      excludeMode: this.pluginSettingsComponent.effectiveSettings.excludeMode,
      isFolder: isFolderPath,
      main: this.ignorePatternsComponent.explain({ isFolder: isFolderPath, normalizedPath }),
      path: normalizedPath,
      soft: this.softExcludePatchComponent.explain(normalizedPath, isFolderPath)
    };
  }

  /**
   * Explains a path the user typed. A file the `Full` mode hid is no longer in the vault, so the disk is asked when the
   * vault does not know the path. A trailing `/` marks a folder that does not exist.
   *
   * @returns The explanation, or `null` for the vault root.
   */
  public async explainTypedPath(typedPath: string): Promise<null | PathExplanation> {
    const trimmedPath = typedPath.trim();
    const normalizedPath = normalizePath(trimmedPath);
    if (normalizedPath === ROOT_PATH || normalizedPath === '') {
      return null;
    }
    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    let isFolderPath: boolean;
    if (file) {
      isFolderPath = isFolder(file);
    } else {
      const stat = await this.app.vault.adapter.stat(normalizedPath);
      isFolderPath = stat ? stat.type === 'folder' : trimmedPath.endsWith('/');
    }
    return this.explain(normalizedPath, isFolderPath);
  }
}
