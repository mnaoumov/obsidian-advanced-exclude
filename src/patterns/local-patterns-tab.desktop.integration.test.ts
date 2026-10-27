import type { FileSystemAdapter } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsTab } from '../settings/plugin-settings-tab.ts';

const PLUGIN_ID = 'advanced-exclude';
const SETTLE_DELAY_IN_MS = 5000;
const NOTE_PATH = 'local-note.md';
const LOCAL_PATTERN = 'local-note.md';
const SECOND_NOTE_PATH = 'second-note.md';

afterEach(async () => {
  await evalInObsidian({
    async callback({ app, NOTE_PATH: notePath, PLUGIN_ID: pluginId, SECOND_NOTE_PATH: secondNotePath }) {
      app.setting.close();
      // `close` does not wait for the tab's hide, which writes the text still waiting to be saved: it would land after
      // the removal below and leave the file for the next test.
      await (app.setting.pluginTabs.find((tab) => tab.id === pluginId) as PluginSettingsTab | undefined)?.hideAsync();
      for (const path of ['.obsidianignore', notePath, secondNotePath]) {
        try {
          await app.vault.adapter.remove(path);
        } catch {
          // Ignore
        }
      }
    },
    input: { NOTE_PATH, PLUGIN_ID, SECOND_NOTE_PATH },
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

  it('writes a burst of edits once, judges a note created mid-edit by the applied patterns, and applies the latest text on hide', async () => {
    const result = await evalInObsidian({
      async callback({
        app,
        lib: { waitUntil },
        LOCAL_PATTERN: localPattern,
        NOTE_PATH: notePath,
        PLUGIN_ID: pluginId,
        SECOND_NOTE_PATH: secondNotePath,
        SETTLE_DELAY_IN_MS: settleDelay
      }) {
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

        await waitUntil({
          message: 'the Local patterns text area to show the header',
          predicate: () => getTextArea()?.value.startsWith('# ') ?? false,
          timeoutInMilliseconds: settleDelay
        });
        const textArea = getTextArea();
        if (!textArea) {
          return { error: 'Local patterns text area not found' };
        }
        const header = textArea.value;

        function typeText(text: string): void {
          if (!textArea) {
            return;
          }
          textArea.value = text;
          textArea.dispatchEvent(new Event('input'));
        }

        // The plugin writes the dot file straight through `fsPromises`, which raises no vault event to count.
        const { fsPromises } = app.vault.adapter as FileSystemAdapter;
        const originalWriteFile = fsPromises.writeFile;
        let writeCount = 0;
        function restoreWriteFile(): void {
          fsPromises.writeFile = originalWriteFile;
        }
        function countWrites(): void {
          fsPromises.writeFile = async (...writeFileArguments: Parameters<typeof originalWriteFile>): Promise<void> => {
            const [file] = writeFileArguments;
            if (typeof file === 'string' && file.endsWith('.obsidianignore')) {
              writeCount++;
            }
            await originalWriteFile.apply(fsPromises, writeFileArguments);
          };
        }
        countWrites();

        try {
          // One edit per keystroke, with no pause between them.
          for (let length = 1; length <= localPattern.length; length++) {
            typeText(`${header}${localPattern.slice(0, length)}`);
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
          // Long enough for any further write the burst would cause.
          await sleep(1000);
          const writeCountAfterBurst = writeCount;

          // Matches the saved but unapplied pattern: it must stay until the tab applies.
          await app.vault.create(notePath, 'Created while the tab is open');
          await sleep(1000);
          const isNoteKeptMidEdit = !!app.vault.getAbstractFileByPath(notePath);

          await app.vault.create(secondNotePath, 'Matched only by the last edit');
          // Hidden at once, before the typing pause ends: the hide must save the latest text first.
          typeText(`${header}${localPattern}\n${secondNotePath}`);
          app.setting.close();
          await settingTab.hideAsync();
          await waitUntil({
            message: 'both notes to leave the vault',
            predicate: () => !app.vault.getAbstractFileByPath(notePath) && !app.vault.getAbstractFileByPath(secondNotePath),
            timeoutInMilliseconds: settleDelay * 3
          });
          const fileContent = await app.vault.adapter.read('.obsidianignore');

          return { error: null, fileContent, isNoteKeptMidEdit, writeCountAfterBurst };
        } finally {
          restoreWriteFile();
        }
      },
      input: { LOCAL_PATTERN, NOTE_PATH, PLUGIN_ID, SECOND_NOTE_PATH, SETTLE_DELAY_IN_MS },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();
    expect(result.writeCountAfterBurst).toBe(1);
    expect(result.isNoteKeptMidEdit).toBe(true);
    expect(result.fileContent?.replaceAll('\r\n', '\n').endsWith(`\n${LOCAL_PATTERN}\n${SECOND_NOTE_PATH}`)).toBe(true);
  });
});
