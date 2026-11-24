// Cspell:ignore linktext
import type { App } from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

import { PluginSettings } from '../settings/plugin-settings.ts';
import {
  getSuggestionFilePath,
  SuggestionRemovalComponent
} from './suggestion-removal-component.ts';

interface FakeSwitcherInstance {
  readonly QuickSwitcherModal: typeof FakeQuickSwitcherModal;
}

const SUGGESTIONS = [
  { file: { path: 'kept.md' }, type: 'file' },
  { file: { path: 'excluded.md' }, type: 'file' },
  { alias: 'Alias', file: { path: 'excluded.md' }, type: 'alias' },
  { linktext: 'nowhere', type: 'unresolved' },
  { item: { path: 'excluded.md', type: 'file' }, type: 'bookmark' },
  { item: { type: 'search' }, type: 'bookmark' }
];

class FakeLinkSuggest {
  public readonly suggestManager = {};

  public getSuggestions(): Promise<unknown[]> {
    return Promise.resolve([...SUGGESTIONS]);
  }
}

class FakeOtherSuggest {
  public getSuggestions(): unknown[] {
    return [...SUGGESTIONS];
  }
}

class FakeQuickSwitcherModal {
  public static result: unknown = null;

  public getSuggestions(): unknown {
    return FakeQuickSwitcherModal.result ?? [...SUGGESTIONS];
  }
}

describe('SuggestionRemovalComponent', () => {
  let component: SuggestionRemovalComponent;
  let linkSuggest: FakeLinkSuggest;
  let otherSuggest: FakeOtherSuggest;
  let settings: PluginSettings;
  let switcherInstance: FakeSwitcherInstance | null;
  let triggerLayoutReady: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    settings = new PluginSettings();
    linkSuggest = new FakeLinkSuggest();
    otherSuggest = new FakeOtherSuggest();
    switcherInstance = { QuickSwitcherModal: class extends FakeQuickSwitcherModal {} };
    triggerLayoutReady = undefined;
  });

  afterEach(() => {
    component.unload();
    vi.useRealTimers();
  });

  function load(): void {
    const app = castTo<App>({
      internalPlugins: {
        getPluginById: (id: string): null | object => id === 'switcher' && switcherInstance ? { instance: switcherInstance } : null
      },
      workspace: {
        editorSuggest: { suggests: [otherSuggest, linkSuggest] },
        onLayoutReady: (callback: () => void): void => {
          triggerLayoutReady = callback;
        }
      }
    });
    component = new SuggestionRemovalComponent({
      app,
      isSoftExcluded: (path): boolean => path === 'excluded.md',
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings })
    });
    component.load();
    triggerLayoutReady?.();
    vi.runAllTimers();
  }

  function newQuickSwitcherModal(): FakeQuickSwitcherModal {
    if (!switcherInstance) {
      throw new Error('No switcher');
    }
    return new switcherInstance.QuickSwitcherModal();
  }

  it('keeps every suggestion while both toggles are off', async () => {
    load();
    expect(newQuickSwitcherModal().getSuggestions()).toEqual(SUGGESTIONS);
    await expect(linkSuggest.getSuggestions()).resolves.toEqual(SUGGESTIONS);
  });

  it('removes soft-excluded files from the quick switcher only', async () => {
    settings.shouldRemoveFromQuickSwitcher = true;
    load();
    expect(newQuickSwitcherModal().getSuggestions()).toEqual([SUGGESTIONS[0], SUGGESTIONS[3], SUGGESTIONS[5]]);
    await expect(linkSuggest.getSuggestions()).resolves.toEqual(SUGGESTIONS);
  });

  it('removes soft-excluded files from link suggestions only', async () => {
    settings.shouldRemoveFromLinkSuggestions = true;
    load();
    await expect(linkSuggest.getSuggestions()).resolves.toEqual([SUGGESTIONS[0], SUGGESTIONS[3], SUGGESTIONS[5]]);
    expect(newQuickSwitcherModal().getSuggestions()).toEqual(SUGGESTIONS);
    expect(otherSuggest.getSuggestions()).toEqual(SUGGESTIONS);
  });

  it('reads the toggles at call time', () => {
    load();
    const modal = newQuickSwitcherModal();
    settings.shouldRemoveFromQuickSwitcher = true;
    expect(modal.getSuggestions()).toHaveLength(3);
    settings.shouldRemoveFromQuickSwitcher = false;
    expect(modal.getSuggestions()).toEqual(SUGGESTIONS);
  });

  it('restores the methods on unload', () => {
    settings.shouldRemoveFromQuickSwitcher = true;
    load();
    component.unload();
    expect(newQuickSwitcherModal().getSuggestions()).toEqual(SUGGESTIONS);
  });

  it('skips what it cannot reach', () => {
    switcherInstance = null;
    linkSuggest = castTo<FakeLinkSuggest>(new FakeOtherSuggest());
    settings.shouldRemoveFromLinkSuggestions = true;
    load();
    expect(otherSuggest.getSuggestions()).toEqual(SUGGESTIONS);
  });

  it('leaves a result that is not a list alone', () => {
    settings.shouldRemoveFromQuickSwitcher = true;
    load();
    const modal = newQuickSwitcherModal();
    FakeQuickSwitcherModal.result = 'not a list';
    expect(modal.getSuggestions()).toBe('not a list');
    FakeQuickSwitcherModal.result = null;
  });
});

describe('getSuggestionFilePath', () => {
  it('reads the file, or the file of a file bookmark', () => {
    expect(getSuggestionFilePath({ file: { path: 'a.md' }, type: 'heading' })).toBe('a.md');
    expect(getSuggestionFilePath({ item: { path: 'b.md', type: 'file' }, type: 'bookmark' })).toBe('b.md');
  });

  it('returns null for a suggestion that points at no file', () => {
    expect(getSuggestionFilePath(null)).toBeNull();
    expect(getSuggestionFilePath('text')).toBeNull();
    expect(getSuggestionFilePath({ file: null, path: 'unresolved', type: 'linktext' })).toBeNull();
    expect(getSuggestionFilePath({ file: { name: 'no path' } })).toBeNull();
    expect(getSuggestionFilePath({ item: { path: 'folder', type: 'folder' }, type: 'bookmark' })).toBeNull();
    expect(getSuggestionFilePath({ item: null, type: 'bookmark' })).toBeNull();
    expect(getSuggestionFilePath({ item: { type: 'file' }, type: 'bookmark' })).toBeNull();
  });
});
