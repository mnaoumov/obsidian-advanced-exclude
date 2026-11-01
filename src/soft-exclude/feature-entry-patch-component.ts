import type { MethodKeys } from '@mnaoumov/obsidian-lib/components/monkey-around-component';
import type { App } from 'obsidian';

import { registerAsyncEvent } from '@mnaoumov/obsidian-lib/components/async-events-component';
import { CallbackLayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import { MonkeyAroundComponent } from '@mnaoumov/obsidian-lib/components/monkey-around-component';
import { getPrototypeOf } from '@mnaoumov/typescript-lib/object-utils';
import { ViewType } from '@obsidian-typings/obsidian-public-latest/implementations';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';
import type { AppHolder } from './feature-scoped-app.ts';

import {
  refreshLinkViews,
  refreshSearchViews
} from '../index-projection/refresh-link-views.ts';
import { ExcludeMode } from '../settings/plugin-settings.ts';
import {
  callWithScopedApp,
  SoftExcludeFeature
} from './feature-scoped-app.ts';

interface FeatureEntryPatchComponentConstructorParams {
  readonly app: App;
  readonly getFeatureScopedApp: (this: void, feature: SoftExcludeFeature) => App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Tells the `Soft` exclude mode which feature asks `metadataCache.isUserIgnored`, for the features that have their own
 * toggle.
 *
 * Each such feature has one entry method that reads `this.app` before its first `await`: the search view's
 * `startSearch`, the graph engine's `render` (global and local graph), and `recomputeUnlinked` of the Backlinks
 * component (the pane, and backlinks shown in a note) and of the Outgoing links component. Their classes are not
 * exported, so each prototype is patched once an instance is reachable: at layout ready, then on `layout-change` and
 * `file-open`. The patch runs the method with `this.app` swapped for an app scoped to the feature (see
 * `callWithScopedApp`). An embedded search query block has no reachable class, so it counts as the other features.
 *
 * A change of the toggles re-runs the open views, which would otherwise show the old verdict until their next
 * refresh, and so does a newly patched class, whose views rendered once before the patch.
 */
export class FeatureEntryPatchComponent extends MonkeyAroundComponent {
  private readonly app: App;
  private appliedToggles: string;
  private readonly getFeatureScopedApp: (feature: SoftExcludeFeature) => App;
  private readonly patchedPrototypes = new WeakSet();
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: FeatureEntryPatchComponentConstructorParams) {
    super();
    this.app = params.app;
    this.getFeatureScopedApp = params.getFeatureScopedApp;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.appliedToggles = this.getToggles();
  }

  public override onload(): void {
    super.onload();
    this.addChild(new CallbackLayoutReadyComponent(this.app, this.onLayoutReady.bind(this)));
    registerAsyncEvent(this, this.pluginSettingsComponent.on('saveSettings', this.onSettingsChange.bind(this)));
    registerAsyncEvent(this, this.pluginSettingsComponent.on('loadSettings', this.onSettingsChange.bind(this)));
  }

  private getReachableEntryPatches(): (() => boolean)[] {
    const { workspace } = this.app;
    const patches: (() => boolean)[] = [];
    for (const { view } of workspace.getLeavesOfType(ViewType.Search)) {
      if ('startSearch' in view) {
        patches.push(() => this.patchEntryMethod(view, 'startSearch', SoftExcludeFeature.Search));
      }
    }
    for (const { view } of workspace.getLeavesOfType(ViewType.Graph)) {
      if ('dataEngine' in view) {
        patches.push(() => this.patchEntryMethod(view.dataEngine, 'render', SoftExcludeFeature.Graph));
      }
    }
    for (const { view } of workspace.getLeavesOfType(ViewType.LocalGraph)) {
      if ('engine' in view) {
        patches.push(() => this.patchEntryMethod(view.engine, 'render', SoftExcludeFeature.Graph));
      }
    }
    for (const { view } of workspace.getLeavesOfType(ViewType.Backlink)) {
      if ('backlink' in view) {
        patches.push(() => this.patchEntryMethod(view.backlink, 'recomputeUnlinked', SoftExcludeFeature.UnlinkedMentions));
      }
    }
    for (const { view } of workspace.getLeavesOfType(ViewType.Markdown)) {
      if (!('backlinks' in view && view.backlinks)) {
        continue;
      }

      const { backlinks } = view;
      patches.push(() => this.patchEntryMethod(backlinks, 'recomputeUnlinked', SoftExcludeFeature.UnlinkedMentions));
    }
    for (const { view } of workspace.getLeavesOfType(ViewType.OutgoingLink)) {
      if ('outgoingLink' in view) {
        patches.push(() => this.patchEntryMethod(view.outgoingLink, 'recomputeUnlinked', SoftExcludeFeature.UnlinkedMentions));
      }
    }
    return patches;
  }

  private getToggles(): string {
    const settings = this.pluginSettingsComponent.settings;
    return JSON.stringify([
      settings.shouldSoftExcludeFromGraph,
      settings.shouldSoftExcludeFromOtherFeatures,
      settings.shouldSoftExcludeFromSearch,
      settings.shouldSoftExcludeFromUnlinkedMentions
    ]);
  }

  private onLayoutReady(): void {
    this.patchReachablePrototypes();
    this.registerEvent(this.app.workspace.on('layout-change', this.patchReachablePrototypes.bind(this)));
    this.registerEvent(this.app.workspace.on('file-open', this.patchReachablePrototypes.bind(this)));
  }

  private onSettingsChange(): void {
    const toggles = this.getToggles();
    if (toggles === this.appliedToggles) {
      return;
    }
    this.appliedToggles = toggles;
    this.refreshViewsInSoftMode();
  }

  /**
   * @typeParam Holder - The object whose prototype carries the entry method.
   * @returns Whether the prototype was patched now, rather than before.
   */
  private patchEntryMethod<Holder extends AppHolder>(holder: Holder, methodName: MethodKeys<Holder>, feature: SoftExcludeFeature): boolean {
    const prototype = getPrototypeOf(holder);
    if (this.patchedPrototypes.has(prototype)) {
      return false;
    }
    this.patchedPrototypes.add(prototype);
    this.registerMethodPatch({
      $object: prototype,
      methodName,
      patchHandler: ({ fallback, originalThis }) => {
        return this.pluginSettingsComponent.effectiveSettings.excludeMode === ExcludeMode.Soft
          ? callWithScopedApp(originalThis, this.getFeatureScopedApp(feature), fallback)
          : fallback();
      }
    });
    return true;
  }

  /**
   * Patches the entry methods of the views open now. A view built before its class was patched has already rendered
   * once with the other features' verdict, so the views re-run when anything was newly patched.
   */
  private patchReachablePrototypes(): void {
    const results = this.getReachableEntryPatches().map((patch) => patch());
    if (results.includes(true)) {
      this.refreshViewsInSoftMode();
    }
  }

  private refreshViewsInSoftMode(): void {
    if (this.pluginSettingsComponent.effectiveSettings.excludeMode !== ExcludeMode.Soft) {
      return;
    }
    refreshLinkViews(this.app);
    refreshSearchViews(this.app);
  }
}
