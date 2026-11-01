import { MonkeyAroundComponent } from '@mnaoumov/obsidian-lib/components/monkey-around-component';
import { isFolder } from '@mnaoumov/obsidian-lib/file-system';
import { App } from 'obsidian';

import type { IgnorePatternsComponent } from '../patterns/ignore-patterns-component.ts';
import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';
import type { PluginSettings } from '../settings/plugin-settings.ts';
import type { PropertyRule } from './property-rules.ts';

import { ExcludeMode } from '../settings/plugin-settings.ts';
import {
  createFeatureScopedApp,
  SoftExcludeFeature
} from './feature-scoped-app.ts';
import {
  doesMatchPropertyRules,
  parsePropertyRules
} from './property-rules.ts';

/**
 * The `Soft: exclude from ...` toggle of each feature.
 */
const FEATURE_SETTING_NAMES = {
  [SoftExcludeFeature.Graph]: 'shouldSoftExcludeFromGraph',
  [SoftExcludeFeature.Other]: 'shouldSoftExcludeFromOtherFeatures',
  [SoftExcludeFeature.Search]: 'shouldSoftExcludeFromSearch',
  [SoftExcludeFeature.UnlinkedMentions]: 'shouldSoftExcludeFromUnlinkedMentions'
} as const satisfies Record<SoftExcludeFeature, keyof PluginSettings>;

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
 *
 * The verdict applies per feature, by the `Soft: exclude from ...` toggles. A call through
 * {@link SoftExcludePatchComponent.getFeatureScopedApp}'s app is the feature it was made for; every other call is
 * {@link SoftExcludeFeature.Other}.
 */
export class SoftExcludePatchComponent extends MonkeyAroundComponent {
  private activeFeature: null | SoftExcludeFeature = null;
  private readonly app: App;
  private readonly featureScopedApps = new Map<SoftExcludeFeature, App>();
  private readonly ignorePatternsComponent: IgnorePatternsComponent;
  private parsedPropertyRules: null | ParsedPropertyRules = null;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: SoftExcludePatchComponentConstructorParams) {
    super();
    this.app = params.app;
    this.ignorePatternsComponent = params.ignorePatternsComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  /**
   * An app whose `metadataCache.isUserIgnored` answers for {@link feature}. Created once per feature.
   *
   * @returns The scoped app.
   */
  public getFeatureScopedApp(feature: SoftExcludeFeature): App {
    let scopedApp = this.featureScopedApps.get(feature);
    if (!scopedApp) {
      const metadataCache = this.app.metadataCache;
      scopedApp = createFeatureScopedApp(this.app, (path) => {
        const previousFeature = this.activeFeature;
        this.activeFeature = feature;
        try {
          return metadataCache.isUserIgnored(path);
        } finally {
          this.activeFeature = previousFeature;
        }
      });
      this.featureScopedApps.set(feature, scopedApp);
    }
    return scopedApp;
  }

  public override onload(): void {
    super.onload();
    this.registerMethodPatch({
      $object: this.app.metadataCache,
      methodName: 'isUserIgnored',
      patchHandler: ({ fallback, originalArguments: [path] }) => fallback() || this.isSoftIgnored(path, this.activeFeature ?? SoftExcludeFeature.Other)
    });
  }

  private getPropertyRules(): readonly PropertyRule[] {
    const text = this.pluginSettingsComponent.settings.propertyRules;
    if (this.parsedPropertyRules?.text !== text) {
      this.parsedPropertyRules = { rules: parsePropertyRules(text), text };
    }
    return this.parsedPropertyRules.rules;
  }

  private isFeatureExcluded(feature: SoftExcludeFeature): boolean {
    return this.pluginSettingsComponent.settings[FEATURE_SETTING_NAMES[feature]];
  }

  private isSoftIgnored(path: string, feature: SoftExcludeFeature): boolean {
    if (this.pluginSettingsComponent.effectiveSettings.excludeMode !== ExcludeMode.Soft || !this.isFeatureExcluded(feature)) {
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
