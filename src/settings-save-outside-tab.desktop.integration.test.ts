import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

const PLUGIN_ID = 'advanced-exclude';
const SETTLE_DELAY_IN_MS = 3000;
const HIDDEN_FOLDER = 'save-outside-tab-archive';
const HIDDEN_FILE = 'save-outside-tab-archive/old.md';

interface PluginWithSettingsComponent {
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

afterEach(async () => {
  await evalInObsidian({
    async callback({ app, HIDDEN_FOLDER: hiddenFolder, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay }) {
      // Back to the default settings and an empty ignore file, so nothing leaks into the suites sharing this vault.
      await app.plugins.disablePluginAndSave(pluginId);
      try {
        await app.vault.adapter.remove(`${app.vault.configDir}/plugins/${pluginId}/data.json`);
      } catch {
        // Ignore
      }
      await app.vault.adapter.write('.obsidianignore', '');
      try {
        await app.vault.adapter.rmdir(hiddenFolder, true);
      } catch {
        // Ignore
      }
      await app.plugins.enablePluginAndSave(pluginId);
      await sleep(settleDelay);
    },
    input: {
      HIDDEN_FOLDER,
      PLUGIN_ID,
      SETTLE_DELAY_IN_MS
    },
    vaultPath: getTemporaryVault().path
  });
});

describe('a settings save made outside the settings tab', () => {
  it('applies the new patterns at once', async () => {
    const result = await evalInObsidian({
      async callback({ app, HIDDEN_FILE: hiddenFile, HIDDEN_FOLDER: hiddenFolder, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay }) {
        await app.vault.adapter.mkdir(hiddenFolder);
        await app.vault.adapter.write(hiddenFile, 'old');
        await sleep(settleDelay);
        const isVisibleBefore = app.vault.getAbstractFileByPath(hiddenFile) !== null;

        // The path `configureCommunityPlugin` takes, which the demo vault's buttons use: an `editAndSave` with the
        // settings tab closed, and nothing that calls `processConfigChanges` afterwards.
        const plugin = app.plugins.getPlugin(pluginId) as null | PluginWithSettingsComponent;
        if (!plugin) {
          return { error: 'Plugin is not loaded', isVisibleAfter: null, isVisibleBefore };
        }
        await plugin.pluginSettingsComponent.editAndSave((settings) => {
          settings.obsidianIgnoreContent = `${hiddenFolder}/\n`;
        });

        return {
          error: null,
          isVisibleAfter: app.vault.getAbstractFileByPath(hiddenFile) !== null,
          isVisibleBefore
        };
      },
      input: {
        HIDDEN_FILE,
        HIDDEN_FOLDER,
        PLUGIN_ID,
        SETTLE_DELAY_IN_MS
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();
    expect(result.isVisibleBefore).toBe(true);
    expect(result.isVisibleAfter).toBe(false);
  });
});
