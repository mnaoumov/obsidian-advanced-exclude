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
const HIDDEN_FILE = 'migrated-note.md';
const LATER_FILE = 'later-note.md';
// `OBSIDIAN_IGNORE_MIGRATION_LOCAL_STORAGE_KEY`, spelled out: importing it would load `obsidian` into the Node side.
const MIGRATION_KEY = 'advanced-exclude:obsidianignore-migrated';

interface PluginWithSettingsComponent {
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

afterEach(async () => {
  await evalInObsidian({
    async callback({ app, HIDDEN_FILE: hiddenFile, LATER_FILE: laterFile, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay }) {
      // Back to the default settings and an empty ignore file, so nothing leaks into the suites sharing this vault.
      await app.plugins.disablePluginAndSave(pluginId);
      for (const path of [`${app.vault.configDir}/plugins/${pluginId}/data.json`, hiddenFile, laterFile]) {
        try {
          await app.vault.adapter.remove(path);
        } catch {
          // Ignore
        }
      }
      await app.vault.adapter.write('.obsidianignore', '');
      await app.plugins.enablePluginAndSave(pluginId);
      await sleep(settleDelay);
    },
    input: {
      HIDDEN_FILE,
      LATER_FILE,
      PLUGIN_ID,
      SETTLE_DELAY_IN_MS
    },
    vaultPath: getTemporaryVault().path
  });
});

describe('an existing .obsidianignore on a device that has not migrated yet', () => {
  it('moves its patterns into the synced settings once, and stops reading the file', async () => {
    const result = await evalInObsidian({
      async callback({
        app,
        HIDDEN_FILE: hiddenFile,
        LATER_FILE: laterFile,
        MIGRATION_KEY: migrationKey,
        PLUGIN_ID: pluginId,
        SETTLE_DELAY_IN_MS: settleDelay
      }) {
        // What a vault set up before the patterns moved looks like: the rules in the file only.
        await app.plugins.disablePluginAndSave(pluginId);
        try {
          await app.vault.adapter.remove(`${app.vault.configDir}/plugins/${pluginId}/data.json`);
        } catch {
          // Ignore
        }
        await app.vault.adapter.write('.obsidianignore', 'migrated-*\n');
        await app.vault.adapter.write(hiddenFile, 'hidden by the migrated rule');
        await app.vault.adapter.write(laterFile, 'named only by a later edit of the file');
        app.saveLocalStorage(migrationKey, null);
        await app.plugins.enablePluginAndSave(pluginId);
        await sleep(settleDelay);

        const plugin = app.plugins.getPlugin(pluginId) as null | PluginWithSettingsComponent;
        if (!plugin) {
          return { error: 'Plugin is not loaded' };
        }
        const migratedSettings = { ...plugin.pluginSettingsComponent.settings };
        const noticeText = [...document.querySelectorAll('.notice')].map((el) => el.textContent).join('\n');
        const isHiddenAfterMigration = app.vault.getAbstractFileByPath(hiddenFile) === null;

        // The migration does not run again, and the file is no longer a source.
        await app.vault.adapter.write('.obsidianignore', 'later-*\n');
        await app.plugins.disablePluginAndSave(pluginId);
        await app.plugins.enablePluginAndSave(pluginId);
        await sleep(settleDelay);

        return {
          error: null,
          isHiddenAfterMigration,
          isLaterVisibleAfterFileEdit: app.vault.getAbstractFileByPath(laterFile) !== null,
          isMarked: app.loadLocalStorage(migrationKey) === true,
          migratedSettings,
          noticeText,
          settingsAfterFileEdit: (app.plugins.getPlugin(pluginId) as null | PluginWithSettingsComponent)?.pluginSettingsComponent.settings
            .obsidianIgnoreContent
        };
      },
      input: {
        HIDDEN_FILE,
        LATER_FILE,
        MIGRATION_KEY,
        PLUGIN_ID,
        SETTLE_DELAY_IN_MS
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();
    expect(result.migratedSettings?.obsidianIgnoreContent).toBe('migrated-*\n');
    expect(result.migratedSettings?.shouldIncludeObsidianIgnorePatterns).toBe(false);
    expect(result.isHiddenAfterMigration).toBe(true);
    expect(result.isMarked).toBe(true);
    expect(result.noticeText).toContain('were copied into them');
    expect(result.isLaterVisibleAfterFileEdit).toBe(true);
    expect(result.settingsAfterFileEdit).toBe('migrated-*\n');
  });
});
