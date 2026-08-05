import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

const PLUGIN_ID = 'advanced-exclude';
const SETTLE_DELAY_IN_MS = 5000;
const HIDE_EMPTY_FOLDERS_SETTING_NAME = 'Hide empty folders';

const ALL_TEST_FILES = [
  '.obsidianignore',
  'alpha/bravo/charlie/hidden.md'
];

const ALL_TEST_FOLDERS = [
  'alpha',
  'delta'
];

afterEach(async () => {
  await evalInObsidian({
    // eslint-disable-next-line unicorn/name-replacements -- `args` is an `obsidian-integration-testing` parameter name.
    args: {
      ALL_TEST_FILES,
      ALL_TEST_FOLDERS,
      HIDE_EMPTY_FOLDERS_SETTING_NAME,
      PLUGIN_ID,
      SETTLE_DELAY_IN_MS
    },
    // eslint-disable-next-line unicorn/name-replacements -- `fn` is an `obsidian-integration-testing` parameter name.
    async fn({ ALL_TEST_FILES: files, ALL_TEST_FOLDERS: folders, app, HIDE_EMPTY_FOLDERS_SETTING_NAME: settingName, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay }) {
      // Toggle the setting back off so it does not leak into other suites sharing
      // The temp vault, then remove the scratch files/folders.
      try {
        const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId) as PluginSettingsTab | undefined;
        if (settingTab) {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const items = [...settingTab.containerEl.querySelectorAll('.setting-item')];
          const item = items.find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
          const toggle = item?.querySelector('.checkbox-container');
          if (toggle?.classList.contains('is-enabled')) {
            (toggle as HTMLElement).click();
          }
          app.setting.close();
          await settingTab.hideAsync();
          await sleep(settleDelay);
        }
      } catch {
        // Ignore
      }

      await app.vault.adapter.write('.obsidianignore', '');
      for (const path of files) {
        try {
          await app.vault.adapter.remove(path);
        } catch {
          // Ignore
        }
      }
      for (const folder of folders) {
        try {
          await app.vault.adapter.rmdir(folder, true);
        } catch {
          // Ignore
        }
      }
    },
    vaultPath: getTempVault().path
  });
});

describe('Hide empty folders — Full mode', () => {
  it('hides a folder chain emptied by exclusion and restores it when the setting is toggled off', async () => {
    const result = await evalInObsidian({
      // eslint-disable-next-line unicorn/name-replacements -- `args` is an `obsidian-integration-testing` parameter name.
      args: {
        HIDE_EMPTY_FOLDERS_SETTING_NAME,
        PLUGIN_ID,
        SETTLE_DELAY_IN_MS
      },
      // eslint-disable-next-line unicorn/name-replacements -- `fn` is an `obsidian-integration-testing` parameter name.
      async fn({ app, HIDE_EMPTY_FOLDERS_SETTING_NAME: settingName, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay }) {
        const plugin = app.plugins.getPlugin(pluginId);
        if (!plugin) {
          return { error: 'Plugin not loaded' };
        }

        function loadedPaths(): string[] {
          return app.vault.getAllLoadedFiles().map((file) => file.path).sort();
        }

        function explorerPaths(): string[] {
          const view = app.workspace.getLeavesOfType('file-explorer')[0]?.view as FileExplorerView | undefined;
          return view?.fileItems ? Object.keys(view.fileItems).sort() : [];
        }

        // Flip the "Hide empty folders" toggle through the real settings UI, then
        // Close the tab so its `hideAsync` runs the projection over the live model.
        async function setHideEmptyFolders(isEnabled: boolean): Promise<void> {
          const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId) as PluginSettingsTab | undefined;
          if (!settingTab) {
            throw new Error('Settings tab not found');
          }
          app.setting.open();
          app.setting.openTabById(pluginId);
          const items = [...settingTab.containerEl.querySelectorAll('.setting-item')];
          const item = items.find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
          const toggle = item?.querySelector('.checkbox-container');
          if (!toggle) {
            throw new Error('Hide empty folders toggle not found');
          }
          if (toggle.classList.contains('is-enabled') !== isEnabled) {
            (toggle as HTMLElement).click();
          }
          app.setting.close();
          await settingTab.hideAsync();
          await sleep(settleDelay);
        }

        // Activate the ignore pattern first, then create the files so the live model
        // Records the excluded `hidden.md` as a child of `charlie` (in Full mode it
        // Never enters Obsidian's index, so the model is the only place that knows it).
        await app.vault.adapter.write('.obsidianignore', 'alpha/bravo/charlie/hidden.md\n');
        await app.plugins.disablePluginAndSave(pluginId);
        await app.plugins.enablePluginAndSave(pluginId);
        await sleep(settleDelay);

        await app.vault.adapter.mkdir('alpha');
        await app.vault.adapter.mkdir('alpha/bravo');
        await app.vault.adapter.mkdir('alpha/bravo/charlie');
        await app.vault.adapter.write('alpha/bravo/charlie/hidden.md', 'excluded');
        await app.vault.adapter.mkdir('delta');
        await sleep(settleDelay);

        const loadedBefore = loadedPaths();

        await setHideEmptyFolders(true);
        const loadedWhenOn = loadedPaths();
        const explorerWhenOn = explorerPaths();

        await setHideEmptyFolders(false);
        const loadedWhenOff = loadedPaths();

        return {
          error: null,
          explorerWhenOn,
          loadedBefore,
          loadedWhenOff,
          loadedWhenOn
        };
      },
      vaultPath: getTempVault().path
    });

    expect(result.error).toBeNull();

    // Sanity: before toggling, the emptied folder chain is still visible.
    expect(result.loadedBefore).toContain('alpha/bravo/charlie');

    // With the setting on, the whole emptied chain is removed from the index...
    expect(result.loadedWhenOn).not.toContain('alpha');
    expect(result.loadedWhenOn).not.toContain('alpha/bravo');
    expect(result.loadedWhenOn).not.toContain('alpha/bravo/charlie');
    // ...but a genuinely empty folder stays visible.
    expect(result.loadedWhenOn).toContain('delta');

    // The File Explorer no longer shows the empty folder chain (the reported symptom).
    expect(result.explorerWhenOn).not.toContain('alpha/bravo/charlie');
    expect(result.explorerWhenOn).toContain('delta');

    // With the setting off, the folder chain comes back; only the excluded file stays hidden.
    expect(result.loadedWhenOff).toContain('alpha');
    expect(result.loadedWhenOff).toContain('alpha/bravo');
    expect(result.loadedWhenOff).toContain('alpha/bravo/charlie');
    expect(result.loadedWhenOff).not.toContain('alpha/bravo/charlie/hidden.md');
  });
});
