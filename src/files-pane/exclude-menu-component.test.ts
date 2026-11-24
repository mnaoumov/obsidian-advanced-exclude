import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type {
  App,
  EventRef,
  TAbstractFile
} from 'obsidian';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  Menu,
  TFile,
  TFolder
} from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { IgnorePatternsComponent } from '../patterns/ignore-patterns-component.ts';

import { LOCAL_PATTERNS_HEADER } from '../patterns/local-patterns.ts';
import { ExcludeMenuLayer } from '../settings/plugin-settings.ts';
import { createFakeSettings } from '../test-helpers/fake-plugin-settings-component.ts';
import { ExcludeMenuComponent } from './exclude-menu-component.ts';

interface IsIgnoredParams {
  readonly normalizedPath: string;
}

interface SetupOptions {
  readonly isIgnored?: (path: string) => boolean;
}

interface SetupResult {
  readonly click: (menu: Menu, title: string) => Promise<void>;
  readonly component: ExcludeMenuComponent;
  readonly fake: ReturnType<typeof createFakeSettings>;
  readonly lastNoticeText: () => null | string;
  readonly openMenu: (fileOrFiles: TAbstractFile | TAbstractFile[]) => Menu;
  readonly saveLocalPatterns: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  readonly setLocalPatternsText: (text: string) => void;
}

function createFiles(): Record<'a' | 'folder' | 'inner' | 'root', TAbstractFile> {
  const dummyVault = castTo<Parameters<typeof TFile.create__>[0]>({});
  const root = TFolder.create__(dummyVault, '/');
  const a = TFile.create__(dummyVault, 'a.md');
  const folder = TFolder.create__(dummyVault, 'f');
  const inner = TFile.create__(dummyVault, 'f/x.md');
  a.parent = root;
  folder.parent = root;
  inner.parent = folder;
  return {
    a: castTo<TAbstractFile>(a),
    folder: castTo<TAbstractFile>(folder),
    inner: castTo<TAbstractFile>(inner),
    root: castTo<TAbstractFile>(root)
  };
}

function setup(options: SetupOptions = {}): SetupResult {
  type MenuCallback = (menu: Menu, fileOrFiles: TAbstractFile | TAbstractFile[]) => void;
  const callbacks = new Map<string, MenuCallback>();
  const app = strictProxy<App>({
    workspace: {
      on: castTo<App['workspace']['on']>(vi.fn((name: string, callback: MenuCallback) => {
        callbacks.set(name, callback);
        return castTo<EventRef>({});
      }))
    }
  });
  const fake = createFakeSettings();
  const saveLocalPatterns = vi.fn<(text: string) => Promise<void>>(() => noopAsync());
  let localPatternsText = LOCAL_PATTERNS_HEADER;
  const ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({
    getLocalPatternsText: (): string => localPatternsText,
    isIgnored: vi.fn(({ normalizedPath }: IsIgnoredParams) => options.isIgnored?.(normalizedPath) ?? true),
    saveLocalPatterns
  });
  const showNotice = vi.fn((_message: DocumentFragment | string) => castTo<ReturnType<PluginNoticeComponent['showNotice']>>({}));
  const pluginNoticeComponent = strictProxy<PluginNoticeComponent>({ showNotice });
  const component = new ExcludeMenuComponent({ app, ignorePatternsComponent, pluginNoticeComponent, pluginSettingsComponent: fake.pluginSettingsComponent });
  component.load();

  function openMenu(fileOrFiles: TAbstractFile | TAbstractFile[]): Menu {
    const menu = Menu.create2__();
    callbacks.get(Array.isArray(fileOrFiles) ? 'files-menu' : 'file-menu')?.(menu, fileOrFiles);
    return menu;
  }

  async function click(menu: Menu, title: string): Promise<void> {
    menu.menuItems__.find((item) => item.title__ === title)?.onClick__?.(new MouseEvent('click'));
    await waitForAllAsyncOperations();
  }

  function lastNoticeText(): null | string {
    const message = showNotice.mock.lastCall?.[0];
    return typeof message === 'string' ? message : message?.textContent ?? null;
  }

  return {
    click,
    component,
    fake,
    lastNoticeText,
    openMenu,
    saveLocalPatterns,
    setLocalPatternsText: (text: string): void => {
      localPatternsText = text;
    }
  };
}

const EXCLUDE = 'Exclude';
const EXCLUDE_EVERYTHING_ELSE = 'Exclude everything else in this folder';

describe('ExcludeMenuComponent', () => {
  it('should add both items to the menu of one file, in the action section', () => {
    const { openMenu } = setup();
    const menu = openMenu(createFiles().a);
    expect(menu.menuItems__.map((item) => [item.title__, item.section])).toStrictEqual([[EXCLUDE, 'action'], [EXCLUDE_EVERYTHING_ELSE, 'action']]);
  });

  it('should add nothing for the vault root, alone or in a selection', () => {
    const { openMenu } = setup();
    const files = createFiles();
    expect(openMenu(files.root).menuItems__).toHaveLength(0);
    expect(openMenu([files.root, files.a]).menuItems__).toHaveLength(0);
  });

  it('should offer only Exclude for a selection across folders', () => {
    const { openMenu } = setup();
    const files = createFiles();
    expect(openMenu([files.a, files.inner]).menuItems__.map((item) => item.title__)).toStrictEqual([EXCLUDE]);
  });

  it('should append the lines to the global patterns and name the layer', async () => {
    const { click, fake, lastNoticeText, openMenu } = setup();
    fake.settings.ignorePatterns = '# mine';
    const files = createFiles();
    await click(openMenu([files.a, files.folder]), EXCLUDE);
    expect(fake.settings.ignorePatterns).toBe('# mine\n/a.md\n/f/\n');
    expect(lastNoticeText()).toBe('Added /a.md, /f/ to the global patterns.');
  });

  it('should name the active profile the global patterns are under', async () => {
    const { click, fake, lastNoticeText, openMenu } = setup();
    fake.settings.profiles = [{ id: 'work', name: 'Work', patterns: '' }];
    await fake.setActiveProfileId('work');
    await click(openMenu(createFiles().a), EXCLUDE);
    expect(lastNoticeText()).toBe('Added /a.md to the global patterns of the base settings, which the active profile Work builds on.');
  });

  it('should write the local patterns file when that layer is chosen', async () => {
    const { click, fake, lastNoticeText, openMenu, saveLocalPatterns, setLocalPatternsText } = setup({ isIgnored: (path) => path !== 'f/x.md' });
    fake.settings.excludeMenuLayer = ExcludeMenuLayer.Local;
    setLocalPatternsText('# local\n');
    await click(openMenu(createFiles().inner), EXCLUDE_EVERYTHING_ELSE);
    expect(saveLocalPatterns).toHaveBeenCalledWith('# local\n/f/*\n!/f/x.md\n');
    expect(fake.settings.ignorePatterns).toBe('');
    expect(lastNoticeText()).toBe('Added /f/*, !/f/x.md to .obsidianignore, on this device only.');
  });

  it('should save nothing when the lines are already there', async () => {
    const { click, fake, lastNoticeText, openMenu, saveLocalPatterns, setLocalPatternsText } = setup();
    fake.settings.ignorePatterns = '/a.md';
    await click(openMenu(createFiles().a), EXCLUDE);
    expect(fake.pluginSettingsComponent.editAndSave).not.toHaveBeenCalled();
    expect(lastNoticeText()).toBe('Nothing to add: the lines are already in the global patterns.');

    fake.settings.excludeMenuLayer = ExcludeMenuLayer.Local;
    setLocalPatternsText('/a.md\n');
    await click(openMenu(createFiles().a), EXCLUDE);
    expect(saveLocalPatterns).not.toHaveBeenCalled();
  });

  it('should say which items another line still shows', async () => {
    const { click, lastNoticeText, openMenu } = setup({ isIgnored: () => false });
    await click(openMenu(createFiles().a), EXCLUDE);
    expect(lastNoticeText()).toBe('Added /a.md to the global patterns.Still shown: a.md. Another line, or the active profile, overrides these lines; see the plugin settings.');
  });

  it('should say which kept items are still excluded', async () => {
    const { click, lastNoticeText, openMenu } = setup({ isIgnored: () => true });
    await click(openMenu(createFiles().folder), EXCLUDE_EVERYTHING_ELSE);
    expect(lastNoticeText()).toBe('Added /*, !/f/ to the global patterns.Still excluded: f. Another line, or the active profile, overrides these lines; see the plugin settings.');
  });

  it('should do nothing for everything else across folders', async () => {
    const { component, fake, lastNoticeText } = setup();
    await component.excludeEverythingElse([{ isFolder: false, path: 'a.md' }, { isFolder: false, path: 'f/x.md' }]);
    expect(fake.settings.ignorePatterns).toBe('');
    expect(lastNoticeText()).toBeNull();
  });
});
