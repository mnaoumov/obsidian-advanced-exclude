import type { DataHandler } from '@mnaoumov/obsidian-lib/data-handler';
import type { PluginEventSource } from '@mnaoumov/obsidian-lib/plugin/plugin-event-source';
import type { App } from 'obsidian';
import type { Promisable } from 'type-fest';

import { PluginSettingsComponentBase } from '@mnaoumov/obsidian-lib/components/plugin-settings-component';

import type {
  EffectiveSettings,
  ImportedFileContents,
  ResolveProfileSettings
} from './profiles.ts';

import { PluginSettings } from './plugin-settings.ts';
import { resolveProfile } from './profiles.ts';

/**
 * The `app.loadLocalStorage` key of the active profile id. Obsidian scopes it to the vault, and it stays on this
 * device: the profiles themselves sync in `data.json`, the choice between them does not.
 */
export const ACTIVE_PROFILE_LOCAL_STORAGE_KEY = 'advanced-exclude:active-profile';

interface EffectiveSettingsCache {
  readonly activeProfileId: null | string;
  readonly effectiveSettings: EffectiveSettings;
  readonly importedFileContents: ImportedFileContents;
  readonly settings: ResolveProfileSettings;
}

interface PluginSettingsComponentConstructorParams {
  readonly app: App;
  readonly dataHandler: DataHandler;
  readonly pluginEventSource: PluginEventSource;
}

export class PluginSettingsComponent extends PluginSettingsComponentBase<PluginSettings> {
  /**
   * The id of the profile active on this device, or `null` for the base settings. An id whose profile was
   * deleted resolves to the base settings too.
   */
  public get activeProfileId(): null | string {
    return this._activeProfileId;
  }

  /**
   * The settings in effect on this device: the base settings overlaid by the active profile. Every runtime
   * decision reads these; {@link settings} stays the base layer the settings tab edits.
   */
  public get effectiveSettings(): EffectiveSettings {
    const settings = this.settings;
    const cache = this.effectiveSettingsCache;
    if (
      cache?.activeProfileId === this._activeProfileId && cache.importedFileContents === this._importedFileContents
      && isSameSettings(cache.settings, settings)
    ) {
      return cache.effectiveSettings;
    }

    const effectiveSettings = resolveProfile({ activeProfileId: this._activeProfileId, importedFileContents: this._importedFileContents, settings });
    this.effectiveSettingsCache = {
      activeProfileId: this._activeProfileId,
      effectiveSettings,
      importedFileContents: this._importedFileContents,
      // The settings object is mutated in place on an edit, so the cache keeps a copy of the references it saw.
      settings: { ...settings }
    };
    return effectiveSettings;
  }

  /**
   * The contents of the vault files the active profile imports with `@import file:`, as last read by
   * `IgnorePatternsComponent`.
   */
  public get importedFileContents(): ImportedFileContents {
    return this._importedFileContents;
  }

  private _activeProfileId: null | string;
  private _importedFileContents: ImportedFileContents = new Map();
  private readonly activeProfileChangeListeners = new Set<() => Promisable<void>>();
  private readonly app: App;
  private effectiveSettingsCache: EffectiveSettingsCache | null = null;

  public constructor(params: PluginSettingsComponentConstructorParams) {
    super({
      ...params,
      pluginSettingsClass: PluginSettings
    });
    this.app = params.app;
    const storedId: unknown = this.app.loadLocalStorage(ACTIVE_PROFILE_LOCAL_STORAGE_KEY);
    this._activeProfileId = typeof storedId === 'string' ? storedId : null;
  }

  /**
   * Registers a listener for a change of the active profile on this device.
   *
   * @returns A function that removes the listener.
   */
  public onActiveProfileChange(listener: () => Promisable<void>): () => void {
    this.activeProfileChangeListeners.add(listener);
    return () => {
      this.activeProfileChangeListeners.delete(listener);
    };
  }

  /**
   * Makes {@link profileId} the active profile on this device (`null` for the base settings), stores the choice in
   * local storage, and waits for every listener.
   */
  public async setActiveProfileId(profileId: null | string): Promise<void> {
    if (profileId === this._activeProfileId) {
      return;
    }
    this._activeProfileId = profileId;
    this.app.saveLocalStorage(ACTIVE_PROFILE_LOCAL_STORAGE_KEY, profileId);
    for (const listener of this.activeProfileChangeListeners) {
      await listener();
    }
  }

  /**
   * Replaces the imported files' contents the effective settings expand. Pass a new map: the memo compares it by
   * reference.
   */
  public setImportedFileContents(importedFileContents: ImportedFileContents): void {
    this._importedFileContents = importedFileContents;
  }
}

function isSameSettings(a: ResolveProfileSettings, b: ResolveProfileSettings): boolean {
  return a.profiles === b.profiles
    && a.ignorePatterns === b.ignorePatterns
    && a.excludeMode === b.excludeMode
    && a.shouldHideEmptyFolders === b.shouldHideEmptyFolders
    && a.shouldIgnoreExcludedFiles === b.shouldIgnoreExcludedFiles
    && a.shouldIncludeGitIgnorePatterns === b.shouldIncludeGitIgnorePatterns;
}
