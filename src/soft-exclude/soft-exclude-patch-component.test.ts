import type {
  App,
  CachedMetadata,
  TAbstractFile
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { IgnorePatternsComponent } from '../patterns/ignore-patterns-component.ts';
import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

import {
  ExcludeMode,
  PluginSettings
} from '../settings/plugin-settings.ts';
import { SoftExcludeFeature } from './feature-scoped-app.ts';
import { SoftExcludePatchComponent } from './soft-exclude-patch-component.ts';

const FOLDER = castTo<TAbstractFile>({ kind: 'folder' });
const FILE = castTo<TAbstractFile>({ kind: 'file' });

vi.mock('@mnaoumov/obsidian-lib/file-system', () => ({
  isFolder: (file: TAbstractFile): boolean => file === FOLDER
}));

interface Fixture {
  readonly app: App;
  readonly component: SoftExcludePatchComponent;
  readonly isIgnored: ReturnType<typeof vi.fn>;
  readonly originalIsUserIgnored: ReturnType<typeof vi.fn>;
  readonly settings: PluginSettings;
}

interface FixtureParams {
  readonly cache?: CachedMetadata | null;
  readonly file?: null | TAbstractFile;
  readonly isIgnored?: boolean;
  readonly isUserIgnored?: boolean;
}

function createFixture(params: FixtureParams = {}): Fixture {
  const originalIsUserIgnored = vi.fn().mockReturnValue(params.isUserIgnored ?? false);
  const app = castTo<App>({
    metadataCache: {
      getCache: vi.fn().mockReturnValue(params.cache ?? null),
      isUserIgnored: originalIsUserIgnored
    },
    vault: {
      getAbstractFileByPath: vi.fn().mockReturnValue(params.file === undefined ? FILE : params.file)
    }
  });
  const settings = new PluginSettings();
  settings.excludeMode = ExcludeMode.Soft;
  const isIgnored = vi.fn().mockReturnValue(params.isIgnored ?? false);
  const component = new SoftExcludePatchComponent({
    app,
    ignorePatternsComponent: strictProxy<IgnorePatternsComponent>({ isIgnored }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ effectiveSettings: settings, settings })
  });
  component.load();
  return { app, component, isIgnored, originalIsUserIgnored, settings };
}

describe('SoftExcludePatchComponent', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = createFixture();
  });

  it('keeps what Obsidian already ignores', () => {
    fixture = createFixture({ isUserIgnored: true });

    expect(fixture.app.metadataCache.isUserIgnored('a.md')).toBe(true);
    expect(fixture.isIgnored).not.toHaveBeenCalled();
  });

  it('adds nothing outside the soft mode', () => {
    fixture = createFixture({ isIgnored: true });
    fixture.settings.excludeMode = ExcludeMode.Full;

    expect(fixture.app.metadataCache.isUserIgnored('a.md')).toBe(false);
    expect(fixture.isIgnored).not.toHaveBeenCalled();
  });

  it('ignores a file the patterns ignore', () => {
    fixture = createFixture({ isIgnored: true });

    expect(fixture.app.metadataCache.isUserIgnored('a.md')).toBe(true);
    expect(fixture.isIgnored).toHaveBeenCalledWith({ isFolder: false, normalizedPath: 'a.md' });
  });

  it('tests a folder in its folder form, and never against the property rules', () => {
    fixture = createFixture({ file: FOLDER });
    fixture.settings.propertyRules = 'secret';

    expect(fixture.app.metadataCache.isUserIgnored('folder')).toBe(false);
    expect(fixture.isIgnored).toHaveBeenCalledWith({ isFolder: true, normalizedPath: 'folder' });
    expect(fixture.app.metadataCache.getCache).not.toHaveBeenCalled();
  });

  it('tests a path the vault does not hold as a file', () => {
    fixture = createFixture({ file: null });

    expect(fixture.app.metadataCache.isUserIgnored('gone.md')).toBe(false);
    expect(fixture.isIgnored).toHaveBeenCalledWith({ isFolder: false, normalizedPath: 'gone.md' });
  });

  it('ignores a note whose properties match a rule', () => {
    fixture = createFixture({ cache: { frontmatter: { visibility: 'gm-only' } } });
    fixture.settings.propertyRules = 'visibility: gm-only';

    expect(fixture.app.metadataCache.isUserIgnored('a.md')).toBe(true);
    expect(fixture.app.metadataCache.getCache).toHaveBeenCalledWith('a.md');
  });

  it('does not ignore a note whose properties match no rule, or that has no metadata', () => {
    fixture = createFixture({ cache: { frontmatter: { visibility: 'public' } } });
    fixture.settings.propertyRules = 'visibility: gm-only';
    expect(fixture.app.metadataCache.isUserIgnored('a.md')).toBe(false);

    fixture = createFixture();
    fixture.settings.propertyRules = 'visibility: gm-only';
    expect(fixture.app.metadataCache.isUserIgnored('a.md')).toBe(false);
  });

  it('reads no metadata while there are no rules', () => {
    expect(fixture.app.metadataCache.isUserIgnored('a.md')).toBe(false);
    expect(fixture.app.metadataCache.getCache).not.toHaveBeenCalled();
  });

  it('re-parses the rules only when their text changes', () => {
    fixture = createFixture({ cache: { frontmatter: { status: 'done' } } });
    fixture.settings.propertyRules = 'status: draft';
    expect(fixture.app.metadataCache.isUserIgnored('a.md')).toBe(false);
    expect(fixture.app.metadataCache.isUserIgnored('a.md')).toBe(false);

    fixture.settings.propertyRules = 'status: done';
    expect(fixture.app.metadataCache.isUserIgnored('a.md')).toBe(true);
  });

  it('applies the verdict to the other features by their toggle', () => {
    fixture = createFixture({ isIgnored: true });
    fixture.settings.shouldSoftExcludeFromOtherFeatures = false;

    expect(fixture.app.metadataCache.isUserIgnored('a.md')).toBe(false);
    expect(fixture.isIgnored).not.toHaveBeenCalled();
  });

  it('answers through a scoped app for its own feature only', () => {
    fixture = createFixture({ isIgnored: true });
    fixture.settings.shouldSoftExcludeFromOtherFeatures = false;
    fixture.settings.shouldSoftExcludeFromSearch = false;

    const unlinkedMentionsApp = fixture.component.getFeatureScopedApp(SoftExcludeFeature.UnlinkedMentions);
    const searchApp = fixture.component.getFeatureScopedApp(SoftExcludeFeature.Search);
    const graphApp = fixture.component.getFeatureScopedApp(SoftExcludeFeature.Graph);

    expect(unlinkedMentionsApp.metadataCache.isUserIgnored('a.md')).toBe(true);
    expect(graphApp.metadataCache.isUserIgnored('a.md')).toBe(true);
    expect(searchApp.metadataCache.isUserIgnored('a.md')).toBe(false);
    // The scope ends with the call.
    expect(fixture.app.metadataCache.isUserIgnored('a.md')).toBe(false);
  });

  it('keeps what Obsidian already ignores in a feature whose toggle is off', () => {
    fixture = createFixture({ isUserIgnored: true });
    fixture.settings.shouldSoftExcludeFromGraph = false;

    expect(fixture.component.getFeatureScopedApp(SoftExcludeFeature.Graph).metadataCache.isUserIgnored('a.md')).toBe(true);
  });

  it('creates one scoped app per feature', () => {
    expect(fixture.component.getFeatureScopedApp(SoftExcludeFeature.Graph)).toBe(fixture.component.getFeatureScopedApp(SoftExcludeFeature.Graph));
    expect(fixture.component.getFeatureScopedApp(SoftExcludeFeature.Graph)).not.toBe(fixture.component.getFeatureScopedApp(SoftExcludeFeature.Search));
  });

  it('restores the outer feature after a nested scoped call', () => {
    fixture = createFixture();
    fixture.settings.shouldSoftExcludeFromGraph = false;
    fixture.settings.shouldSoftExcludeFromOtherFeatures = false;
    const graphApp = fixture.component.getFeatureScopedApp(SoftExcludeFeature.Graph);
    const searchApp = fixture.component.getFeatureScopedApp(SoftExcludeFeature.Search);
    const results: boolean[] = [];
    fixture.isIgnored.mockImplementationOnce(() => {
      const isIgnoredInNestedGraph = graphApp.metadataCache.isUserIgnored('b.md');
      // Back in the search scope: a plain call made inside it answers for search.
      results.push(isIgnoredInNestedGraph, fixture.app.metadataCache.isUserIgnored('c.md'));
      return true;
    }).mockReturnValue(true);

    expect(searchApp.metadataCache.isUserIgnored('a.md')).toBe(true);
    expect(results).toEqual([false, true]);
    expect(fixture.app.metadataCache.isUserIgnored('a.md')).toBe(false);
  });

  it('restores the original method on unload', () => {
    fixture = createFixture({ isIgnored: true });
    fixture.component.unload();

    expect(fixture.app.metadataCache.isUserIgnored('a.md')).toBe(false);
    expect(fixture.originalIsUserIgnored).toHaveBeenCalledOnce();
  });
});
