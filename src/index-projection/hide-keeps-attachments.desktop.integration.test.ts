import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  expect,
  it
} from 'vitest';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

interface PluginWithSettings {
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface Stage {
  readonly deletes: number;
  readonly missingOnDisk: readonly string[];
  readonly name: string;
  readonly visible: readonly string[];
}

/*
 * The shape of the 2026-06-22 vault loss: a pre-S6 build hid `WiFi.md` with `reconcileDeletion`, the `delete` event
 * reached the attachment plugins' "delete attachments with note" handlers, and they removed the note's attachments
 * from disk while those were still in the index.
 */
it('hides and re-shows a note without letting a delete-attachments-with-note listener remove its attachments', async () => {
  const result = await evalInObsidian({
    async callback({ app, lib: { waitUntil } }) {
      const notePath = 'hide-keeps-attachments/WiFi.md';
      const attachmentPaths = ['hide-keeps-attachments/!!files/WiFi/Router.jpg', 'hide-keeps-attachments/!!files/WiFi/TV.jpg'];
      const allPaths = [notePath, ...attachmentPaths];
      const plugin = app.plugins.getPlugin('advanced-exclude') as null | PluginWithSettings;
      if (!plugin) {
        throw new Error('Plugin missing');
      }

      await app.vault.adapter.mkdir('hide-keeps-attachments/!!files/WiFi');
      for (const attachmentPath of attachmentPaths) {
        await app.vault.adapter.writeBinary(attachmentPath, new ArrayBuffer(8));
      }
      await app.vault.adapter.write(notePath, attachmentPaths.map((path) => `![[${path}]]`).join('\n'));
      await waitUntil({ message: 'fixture indexed', predicate: () => allPaths.every((path) => app.vault.getAbstractFileByPath(path) !== null) });

      let deletes = 0;
      const removals: Promise<void>[] = [];
      const deleteRef = app.vault.on('delete', (file) => {
        deletes++;
        if (file.path === notePath) {
          // What a "delete attachments with note" setting does: the note is gone, so its attachment folder goes too.
          removals.push(app.vault.adapter.rmdir('hide-keeps-attachments/!!files/WiFi', true));
        }
      });

      const stages: Stage[] = [];
      async function record(name: string): Promise<void> {
        await Promise.allSettled(removals);
        const missingOnDisk: string[] = [];
        for (const path of allPaths) {
          if (!await app.vault.adapter.exists(path)) {
            missingOnDisk.push(path);
          }
        }
        stages.push({ deletes, missingOnDisk, name, visible: allPaths.filter((path) => app.vault.getAbstractFileByPath(path) !== null) });
      }

      function isHidden(): boolean {
        return allPaths.every((path) => app.vault.getAbstractFileByPath(path) === null);
      }

      function isShown(): boolean {
        return allPaths.every((path) => app.vault.getAbstractFileByPath(path) !== null);
      }

      // A stage that never settles is still recorded, so a failure shows which files went missing, not only a timeout.
      async function settle(message: string, isSettled: () => boolean): Promise<void> {
        try {
          await waitUntil({ message, predicate: isSettled });
        } catch {
          // Ignore
        }
      }

      const originalPatterns = plugin.pluginSettingsComponent.settings.ignorePatterns;
      try {
        await plugin.pluginSettingsComponent.editAndSave((settings) => {
          settings.ignorePatterns = 'W*';
        });
        await settle('W* hidden', isHidden);
        await record('hidden');

        await app.plugins.disablePlugin('advanced-exclude');
        await settle('restored on disable', isShown);
        await record('disabled while hidden');

        await app.plugins.enablePlugin('advanced-exclude');
        await settle('hidden again on enable', isHidden);
        await record('re-enabled');

        const reEnabledPlugin = app.plugins.getPlugin('advanced-exclude') as null | PluginWithSettings;
        if (!reEnabledPlugin) {
          throw new Error('Plugin missing after enable');
        }
        await reEnabledPlugin.pluginSettingsComponent.editAndSave((settings) => {
          settings.ignorePatterns = originalPatterns;
        });
        await settle('W* shown', isShown);
        await record('shown');
      } finally {
        app.vault.offref(deleteRef);
        const currentPlugin = app.plugins.getPlugin('advanced-exclude') as null | PluginWithSettings;
        await currentPlugin?.pluginSettingsComponent.editAndSave((settings) => {
          settings.ignorePatterns = originalPatterns;
        });
        await app.vault.adapter.rmdir('hide-keeps-attachments', true);
      }
      return stages;
    },
    vaultPath: getTemporaryVault().path
  });

  const allPaths = ['hide-keeps-attachments/WiFi.md', 'hide-keeps-attachments/!!files/WiFi/Router.jpg', 'hide-keeps-attachments/!!files/WiFi/TV.jpg'];
  expect(result).toEqual([
    { deletes: 0, missingOnDisk: [], name: 'hidden', visible: [] },
    { deletes: 0, missingOnDisk: [], name: 'disabled while hidden', visible: allPaths },
    { deletes: 0, missingOnDisk: [], name: 're-enabled', visible: [] },
    { deletes: 0, missingOnDisk: [], name: 'shown', visible: allPaths }
  ]);
});
