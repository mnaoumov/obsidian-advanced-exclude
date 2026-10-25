import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

const PLUGIN_ID = 'advanced-exclude';
const SETTLE_DELAY_IN_MS = 5000;
const NOTE_PATH = 'local-note.md';
const LOCAL_PATTERN = 'local-note.md';

afterEach(async () => {
  await evalInObsidian({
    async callback({ app, NOTE_PATH: notePath }) {
      app.setting.close();
      for (const path of ['.obsidianignore', notePath]) {
        try {
          await app.vault.adapter.remove(path);
        } catch {
          // Ignore
        }
      }
    },
    input: { NOTE_PATH },
    vaultPath: getTemporaryVault().path
  });
});

describe('Settings tab — local patterns', () => {
  it('shows the header for a missing .obsidianignore, creates the file only on the first edit, and applies it', async () => {
    const result = await evalInObsidian({
      async callback({
        app,
        lib: { pressKey, waitUntil },
        LOCAL_PATTERN: localPattern,
        NOTE_PATH: notePath,
        PLUGIN_ID: pluginId,
        SETTLE_DELAY_IN_MS: settleDelay
      }) {
        await app.vault.create(notePath, 'Hidden on this device only');

        const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId) as PluginSettingsTab | undefined;
        if (!settingTab) {
          return { error: 'Settings tab not found' };
        }
        app.setting.open();
        app.setting.openTabById(pluginId);

        function getTextArea(): HTMLTextAreaElement | null {
          const items = [...(settingTab?.containerEl.querySelectorAll('.setting-item') ?? [])];
          const item = items.find((el) => el.querySelector('.setting-item-name')?.textContent === 'Local patterns');
          return item?.querySelector('textarea') ?? null;
        }

        // The tab re-reads the file as it renders, so a file deleted behind the plugin's back shows as missing.
        await waitUntil({
          message: 'the Local patterns text area to show the header',
          predicate: () => getTextArea()?.value.startsWith('# ') ?? false,
          timeoutInMilliseconds: settleDelay
        });
        const textArea = getTextArea();
        if (!textArea) {
          return { error: 'Local patterns text area not found' };
        }

        const shownText = textArea.value;
        const doesFileExistBeforeEdit = await app.vault.adapter.exists('.obsidianignore');

        textArea.focus();
        textArea.setSelectionRange(textArea.value.length, textArea.value.length);
        for (const key of localPattern) {
          await pressKey({ key });
        }
        await waitUntil({
          message: '.obsidianignore to carry the typed pattern',
          predicate: async () => {
            if (!await app.vault.adapter.exists('.obsidianignore')) {
              return false;
            }
            const content = await app.vault.adapter.read('.obsidianignore');
            return content.includes(localPattern);
          },
          timeoutInMilliseconds: settleDelay
        });
        const fileContent = await app.vault.adapter.read('.obsidianignore');

        app.setting.close();
        await settingTab.hideAsync();
        await waitUntil({
          message: `${notePath} to leave the vault`,
          predicate: () => !app.vault.getAbstractFileByPath(notePath),
          timeoutInMilliseconds: settleDelay * 3
        });

        return { doesFileExistBeforeEdit, error: null, fileContent, shownText };
      },
      input: { LOCAL_PATTERN, NOTE_PATH, PLUGIN_ID, SETTLE_DELAY_IN_MS },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();
    expect(result.shownText).toMatch(/^# \.obsidianignore: /);
    expect(result.doesFileExistBeforeEdit).toBe(false);
    expect(result.fileContent).toMatch(/^# \.obsidianignore: /);
    expect(result.fileContent?.replaceAll('\r\n', '\n').endsWith(`\n${LOCAL_PATTERN}`)).toBe(true);
  });
});
