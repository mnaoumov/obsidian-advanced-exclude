import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type {
  App,
  EventRef,
  TAbstractFile
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
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

import type { PathExplainer } from '../explain/path-explainer.ts';
import type { PathExplanation } from '../explain/path-explanation.ts';

import { ExcludeMode } from '../settings/plugin-settings.ts';
import { ExplainMenuComponent } from './explain-menu-component.ts';

const NO_MATCH = { decidingLine: null, excludedFolderPath: null, isIgnored: false, overriddenLines: [] };

interface Setup {
  readonly explain: ReturnType<typeof vi.fn<PathExplainer['explain']>>;
  readonly files: Record<'folder' | 'root', TAbstractFile>;
  readonly openMenu: (file: TAbstractFile) => Menu;
  readonly showNotice: ReturnType<typeof vi.fn<(message: DocumentFragment | string) => ReturnType<PluginNoticeComponent['showNotice']>>>;
}

describe('ExplainMenuComponent', () => {
  function setup(): Setup {
    type MenuCallback = (menu: Menu, file: TAbstractFile) => void;
    const callbacks = new Map<string, MenuCallback>();
    const app = strictProxy<App>({
      workspace: {
        on: castTo<App['workspace']['on']>(vi.fn((name: string, callback: MenuCallback) => {
          callbacks.set(name, callback);
          return castTo<EventRef>({});
        }))
      }
    });
    const explain = vi.fn<PathExplainer['explain']>((path, isFolder): PathExplanation => ({
      excludeMode: ExcludeMode.Full,
      isFolder,
      main: { excludedFilesEntry: null, isIgnored: false, patterns: NO_MATCH },
      path,
      soft: { excludedFeatures: [], isSoftMode: false, propertyRule: null, softPatterns: null }
    }));
    const showNotice = vi.fn((_message: DocumentFragment | string) => castTo<ReturnType<PluginNoticeComponent['showNotice']>>({}));
    const component = new ExplainMenuComponent({
      app,
      pathExplainer: strictProxy<PathExplainer>({ explain }),
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice })
    });
    component.load();

    const dummyVault = castTo<Parameters<typeof TFile.create__>[0]>({});
    const root = TFolder.create__(dummyVault, '/');
    const folder = TFolder.create__(dummyVault, 'f');
    folder.parent = root;

    return {
      explain,
      files: { folder: castTo<TAbstractFile>(folder), root: castTo<TAbstractFile>(root) },
      openMenu: (file): Menu => {
        const menu = Menu.create2__();
        callbacks.get('file-menu')?.(menu, file);
        return menu;
      },
      showNotice
    };
  }

  it('shows the explanation of the item in a notice', () => {
    const { explain, files, openMenu, showNotice } = setup();

    const menu = openMenu(files.folder);
    const item = menu.menuItems__.find((menuItem) => menuItem.title__ === 'Why is this excluded?');
    item?.onClick__?.(new MouseEvent('click'));

    expect(explain).toHaveBeenCalledWith('f', true);
    const message = showNotice.mock.lastCall?.[0];
    expect(typeof message === 'string' ? message : message?.textContent).toBe('The folder f is not excluded.Patterns: no line matches it.');
  });

  it('adds nothing to the vault root', () => {
    const { files, openMenu } = setup();

    expect(openMenu(files.root).menuItems__).toHaveLength(0);
  });
});
