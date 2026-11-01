import { MonkeyAroundComponent } from '@mnaoumov/obsidian-lib/components/monkey-around-component';
import { isFolder } from '@mnaoumov/obsidian-lib/file-system';
import { App } from 'obsidian';

import type { IgnorePatternsComponent } from '../patterns/ignore-patterns-component.ts';
import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';
import type { PropertyRule } from './property-rules.ts';

import { ExcludeMode } from '../settings/plugin-settings.ts';
import {
  doesMatchPropertyRules,
  parsePropertyRules
} from './property-rules.ts';

interface ParsedPropertyRules {
  readonly rules: readonly PropertyRule[];
  readonly text: string;
}

interface SoftExcludePatchComponentConstructorParams {
  readonly app: App;
  readonly ignorePatternsComponent: IgnorePatternsComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * The `Soft` exclude mode: an ignored file stays in the vault, the Files pane, backlinks and link resolution,
 * and is left out of what Obsidian's own `Files and links > Excluded files` leaves it out of — search, the quick
 * switcher, link suggestions, graph, unlinked mentions, Bases, the tag pane.
 *
 * Every one of those asks `metadataCache.isUserIgnored(path)`, so this adds the plugin's verdict to that one method: the
 * patterns, then the `Exclude notes by property` rules. Nothing is removed from the index, so no file-system call is
 * touched. The property rules need the file's metadata, which is why they work in this mode only.
 */
export class SoftExcludePatchComponent extends MonkeyAroundComponent {
  private readonly app: App;
  private readonly ignorePatternsComponent: IgnorePatternsComponent;
  private parsedPropertyRules: null | ParsedPropertyRules = null;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: SoftExcludePatchComponentConstructorParams) {
    super();
    this.app = params.app;
    this.ignorePatternsComponent = params.ignorePatternsComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  public override onload(): void {
    super.onload();
    this.registerMethodPatch({
      $object: this.app.metadataCache,
      methodName: 'isUserIgnored',
      patchHandler: ({ fallback, originalArguments: [path] }) => fallback() || this.isSoftIgnored(path)
    });
  }

  private getPropertyRules(): readonly PropertyRule[] {
    const text = this.pluginSettingsComponent.settings.propertyRules;
    if (this.parsedPropertyRules?.text !== text) {
      this.parsedPropertyRules = { rules: parsePropertyRules(text), text };
    }
    return this.parsedPropertyRules.rules;
  }

  private isSoftIgnored(path: string): boolean {
    if (this.pluginSettingsComponent.effectiveSettings.excludeMode !== ExcludeMode.Soft) {
      return false;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    const isFolderPath = file !== null && isFolder(file);
    if (this.ignorePatternsComponent.isIgnored({ isFolder: isFolderPath, normalizedPath: path })) {
      return true;
    }
    if (isFolderPath) {
      return false;
    }
    const rules = this.getPropertyRules();
    return rules.length > 0 && doesMatchPropertyRules(this.app.metadataCache.getCache(path)?.frontmatter, rules);
  }
}
