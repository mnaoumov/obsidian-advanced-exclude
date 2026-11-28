import type { GenericFunction } from '@mnaoumov/typescript-lib/function';
import type { App } from 'obsidian';

import { CallbackLayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import { MonkeyAroundComponent } from '@mnaoumov/obsidian-lib/components/monkey-around-component';
import { InternalPluginName } from '@obsidian-typings/obsidian-public-latest/implementations';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

interface SuggestionRemovalComponentConstructorParams {
  readonly app: App;
  readonly isSoftExcluded: (this: void, path: string) => boolean;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface SuggestionsSource {
  readonly getSuggestions: GenericFunction;
}

/**
 * Removes the files the plugin soft-excludes from the quick switcher and from the editor's link suggestions, when
 * `Remove from the quick switcher` / `Remove from link suggestions` is on.
 *
 * Obsidian itself only ranks an excluded file lower in those two lists (its score drops by `10`), which is what the
 * `Soft` exclude mode gets for free through `metadataCache.isUserIgnored`. This filters the lists' own output instead,
 * so the shared `metadataCache.getLinkSuggestions` other plugins call is left alone. A suggestion that points at no
 * file (unresolved link text, a non-file bookmark) is always kept, and Obsidian's own `Excluded files` keep their
 * lower rank.
 *
 * Ported from `Hide Excluded Files MORE` (0BSD).
 */
export class SuggestionRemovalComponent extends MonkeyAroundComponent {
  private readonly app: App;
  private readonly isSoftExcluded: (path: string) => boolean;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: SuggestionRemovalComponentConstructorParams) {
    super();
    this.app = params.app;
    this.isSoftExcluded = params.isSoftExcluded;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  public override onload(): void {
    super.onload();
    this.addChild(new CallbackLayoutReadyComponent(this.app, this.onLayoutReady.bind(this)));
  }

  private filterSuggestions(suggestions: unknown): unknown {
    if (Array.isArray(suggestions)) {
      return suggestions.filter((suggestion) => {
        const path = getSuggestionFilePath(suggestion);
        return path === null || !this.isSoftExcluded(path);
      });
    }
    if (suggestions instanceof Promise) {
      return suggestions.then((resolved: unknown) => this.filterSuggestions(resolved));
    }
    return suggestions;
  }

  private onLayoutReady(): void {
    const quickSwitcherModalConstructor = this.app.internalPlugins.getPluginById(InternalPluginName.Switcher)?.instance.QuickSwitcherModal;
    if (quickSwitcherModalConstructor) {
      this.patchSuggestions(quickSwitcherModalConstructor.prototype, () => this.pluginSettingsComponent.settings.shouldRemoveFromQuickSwitcher);
    }

    const linkSuggest = this.app.workspace.editorSuggest.suggests.find((suggest) => 'suggestManager' in suggest);
    if (linkSuggest) {
      this.patchSuggestions(linkSuggest, () => this.pluginSettingsComponent.settings.shouldRemoveFromLinkSuggestions);
    }
  }

  private patchSuggestions(source: SuggestionsSource, isEnabled: () => boolean): void {
    this.registerMethodPatch({
      $object: source,
      methodName: 'getSuggestions',
      patchHandler: ({ fallback }) => {
        const suggestions = fallback();
        return isEnabled() ? this.filterSuggestions(suggestions) : suggestions;
      }
    });
  }
}

/**
 * The path of the file a quick switcher or link suggestion points at: its `file`, or the file of a file bookmark.
 *
 * @returns The path, or `null` for a suggestion that points at no file.
 */
export function getSuggestionFilePath(suggestion: unknown): null | string {
  if (!isRecord(suggestion)) {
    return null;
  }
  const { file, item, type } = suggestion;
  if (isRecord(file) && typeof file['path'] === 'string') {
    return file['path'];
  }
  if (type === 'bookmark' && isRecord(item) && item['type'] === 'file' && typeof item['path'] === 'string') {
    return item['path'];
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
