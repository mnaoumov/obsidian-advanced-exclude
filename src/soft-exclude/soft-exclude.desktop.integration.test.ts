import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';
import type { PluginSettings } from '../settings/plugin-settings.ts';

import { ExcludeMode } from '../settings/plugin-settings.ts';

interface PluginWithSettingsComponent {
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

const PLUGIN_ID = 'advanced-exclude';
const SETTLE_DELAY_IN_MS = 3000;
const TEST_FOLDER = 'soft-exclude';

afterEach(async () => {
  await evalInObsidian({
    async callback({ app, FULL_MODE: fullMode, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay, TEST_FOLDER: folder }) {
      const plugin = app.plugins.getPlugin(pluginId) as null | PluginWithSettingsComponent;
      await plugin?.pluginSettingsComponent.editAndSave((settings) => {
        settings.excludeMode = fullMode;
        settings.ignorePatterns = '';
        settings.propertyRules = '';
      });
      await sleep(settleDelay);
      try {
        await app.vault.adapter.rmdir(folder, true);
      } catch {
        // Ignore
      }
    },
    input: { FULL_MODE: ExcludeMode.Full, PLUGIN_ID, SETTLE_DELAY_IN_MS, TEST_FOLDER },
    vaultPath: getTemporaryVault().path
  });
});

describe('Soft exclude mode', () => {
  it('feeds the patterns and the property rules to isUserIgnored, and moves files in and out of the index on a mode switch', async () => {
    const result = await evalInObsidian({
      async callback({ app, FULL_MODE: fullMode, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay, SOFT_MODE: softMode, TEST_FOLDER: folder }) {
        const plugin = app.plugins.getPlugin(pluginId) as null | PluginWithSettingsComponent;
        if (!plugin) {
          return { error: 'Plugin not loaded' };
        }
        const dropPath = `${folder}/drop.md`;
        const gmPath = `${folder}/gm.md`;
        const keepPath = `${folder}/keep.md`;

        async function edit(editor: (settings: PluginSettings) => void): Promise<void> {
          await plugin?.pluginSettingsComponent.editAndSave(editor);
          await sleep(settleDelay);
        }

        function snapshot(): Record<string, boolean> {
          return {
            dropIgnored: app.metadataCache.isUserIgnored(dropPath),
            dropLoaded: app.vault.getAbstractFileByPath(dropPath) !== null,
            gmIgnored: app.metadataCache.isUserIgnored(gmPath),
            gmLoaded: app.vault.getAbstractFileByPath(gmPath) !== null,
            keepIgnored: app.metadataCache.isUserIgnored(keepPath)
          };
        }

        await app.vault.adapter.mkdir(folder);
        await app.vault.adapter.write(dropPath, 'drop');
        await app.vault.adapter.write(gmPath, '---\nvisibility: GM-only\n---\nsecret');
        await app.vault.adapter.write(keepPath, 'keep [[drop]]');
        await sleep(settleDelay);

        await edit((settings) => {
          settings.ignorePatterns = `${dropPath}\n`;
          settings.propertyRules = 'visibility: gm-only';
        });
        const full = snapshot();

        await edit((settings) => {
          settings.excludeMode = softMode;
        });
        const soft = snapshot();

        await edit((settings) => {
          settings.propertyRules = '';
        });
        const softWithoutRules = snapshot();

        await edit((settings) => {
          settings.excludeMode = fullMode;
        });
        const fullAgain = snapshot();

        return { error: null, full, fullAgain, soft, softWithoutRules };
      },
      input: { FULL_MODE: ExcludeMode.Full, PLUGIN_ID, SETTLE_DELAY_IN_MS, SOFT_MODE: ExcludeMode.Soft, TEST_FOLDER },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();

    // `Full` mode keeps the ignored file out of the index; the property rules do not apply there.
    expect(result.full).toMatchObject({ dropLoaded: false, gmIgnored: false, gmLoaded: true });

    // `Soft` mode puts it back in the index and leaves it out of what `isUserIgnored` feeds, with the note the rule matches.
    expect(result.soft).toEqual({ dropIgnored: true, dropLoaded: true, gmIgnored: true, gmLoaded: true, keepIgnored: false });

    expect(result.softWithoutRules).toMatchObject({ dropIgnored: true, gmIgnored: false });

    // Back in `Full` mode the file leaves the index again, and `isUserIgnored` is Obsidian's own once more.
    expect(result.fullAgain).toMatchObject({ dropIgnored: false, dropLoaded: false, keepIgnored: false });
  });
});
