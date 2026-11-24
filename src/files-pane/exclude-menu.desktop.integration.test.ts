import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

import { ExcludeMenuLayer } from '../settings/plugin-settings.ts';

const PLUGIN_ID = 'advanced-exclude';
const SETTLE_DELAY_IN_MS = 3000;
const FOLDER = 'exclude-menu-test';
const KEPT_FILE = 'exclude-menu-test/keep.md';
const OTHER_FILE = 'exclude-menu-test/other.md';
const INNER_FILE = 'exclude-menu-test/sub/inner.md';

interface PluginWithSettingsComponent {
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface RealMenuItem {
  readonly callback?: () => void;
  readonly titleEl: HTMLElement;
}

async function resetVault(): Promise<void> {
  await evalInObsidian({
    async callback({ app, FOLDER: folder, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay }) {
      // Back to the default settings and an empty ignore file, so nothing leaks into the suites sharing this vault.
      await app.plugins.disablePluginAndSave(pluginId);
      try {
        await app.vault.adapter.remove(`${app.vault.configDir}/plugins/${pluginId}/data.json`);
      } catch {
        // Ignore
      }
      await app.vault.adapter.write('.obsidianignore', '');
      try {
        await app.vault.adapter.rmdir(folder, true);
      } catch {
        // Ignore
      }
      await app.plugins.enablePluginAndSave(pluginId);
      await sleep(settleDelay);
    },
    input: {
      FOLDER,
      PLUGIN_ID,
      SETTLE_DELAY_IN_MS
    },
    vaultPath: getTemporaryVault().path
  });
}

beforeEach(resetVault);
afterEach(resetVault);

interface RunMenuActionParams {
  readonly isLocalLayer: boolean;
  readonly itemTitle: string;
  readonly targetPath: string;
}

interface RunMenuActionResult {
  readonly error: null | string;
  readonly globalPatterns: string;
  readonly localPatterns: string;
  readonly visiblePaths: readonly string[];
}

/**
 * Builds the folder, opens the Files pane menu of {@link RunMenuActionParams.targetPath} the way Obsidian does, clicks
 * the named item, and reports what stayed visible and where the lines went.
 */
async function runMenuAction(params: RunMenuActionParams): Promise<RunMenuActionResult> {
  return await evalInObsidian({
    async callback({
      app,
      FOLDER: folder,
      INNER_FILE: innerFile,
      IS_LOCAL_LAYER: isLocalLayer,
      ITEM_TITLE: itemTitle,
      KEPT_FILE: keptFile,
      LOCAL_LAYER: localLayer,
      obsidianModule,
      OTHER_FILE: otherFile,
      PLUGIN_ID: pluginId,
      SETTLE_DELAY_IN_MS: settleDelay,
      TARGET_PATH: targetPath
    }) {
      const emptyResult = { globalPatterns: '', localPatterns: '', visiblePaths: [] };
      await app.vault.adapter.mkdir(`${folder}/sub`);
      await app.vault.adapter.write(keptFile, 'keep');
      await app.vault.adapter.write(otherFile, 'other');
      await app.vault.adapter.write(innerFile, 'inner');
      await sleep(settleDelay);

      const plugin = app.plugins.getPlugin(pluginId) as null | PluginWithSettingsComponent;
      if (!plugin) {
        return { ...emptyResult, error: 'Plugin is not loaded' };
      }
      if (isLocalLayer) {
        await plugin.pluginSettingsComponent.editAndSave((settings) => {
          settings.excludeMenuLayer = localLayer;
        });
      }

      const target = app.vault.getAbstractFileByPath(targetPath);
      if (!target) {
        return { ...emptyResult, error: `${targetPath} is not in the vault` };
      }
      const menu = new obsidianModule.Menu();
      app.workspace.trigger('file-menu', menu, target, 'file-explorer-context-menu');
      // Items is internal: the public typings leave it out.
      const items = Reflect.get(menu, 'items') as readonly RealMenuItem[];
      const item = items.find((menuItem) => menuItem.titleEl.textContent === itemTitle);
      if (!item?.callback) {
        menu.hide();
        return { ...emptyResult, error: `No ${itemTitle} item in ${items.map((menuItem) => menuItem.titleEl.textContent).join(', ')}` };
      }
      item.callback();
      menu.hide();
      await sleep(settleDelay);

      const visiblePaths = [keptFile, otherFile, innerFile].filter((path) => app.vault.getAbstractFileByPath(path) !== null);
      return {
        error: null,
        globalPatterns: plugin.pluginSettingsComponent.settings.ignorePatterns,
        localPatterns: await app.vault.adapter.read('.obsidianignore'),
        visiblePaths
      };
    },
    input: {
      FOLDER,
      INNER_FILE,
      IS_LOCAL_LAYER: params.isLocalLayer,
      ITEM_TITLE: params.itemTitle,
      KEPT_FILE,
      LOCAL_LAYER: ExcludeMenuLayer.Local,
      OTHER_FILE,
      PLUGIN_ID,
      SETTLE_DELAY_IN_MS,
      TARGET_PATH: params.targetPath
    },
    vaultPath: getTemporaryVault().path
  });
}

describe('the Files pane menu', () => {
  it('excludes the clicked file through the global patterns', async () => {
    const result = await runMenuAction({ isLocalLayer: false, itemTitle: 'Exclude', targetPath: OTHER_FILE });
    expect(result.error).toBeNull();
    expect(result.globalPatterns).toBe(`/${OTHER_FILE}\n`);
    expect(result.localPatterns).toBe('');
    expect(result.visiblePaths).toStrictEqual([KEPT_FILE, INNER_FILE]);
  });

  it('excludes everything else in the folder through .obsidianignore', async () => {
    const result = await runMenuAction({ isLocalLayer: true, itemTitle: 'Exclude everything else in this folder', targetPath: KEPT_FILE });
    expect(result.error).toBeNull();
    expect(result.globalPatterns).toBe('');
    expect(result.localPatterns).toBe(`/${FOLDER}/*\n!/${KEPT_FILE}\n`);
    expect(result.visiblePaths).toStrictEqual([KEPT_FILE]);
  });
});
