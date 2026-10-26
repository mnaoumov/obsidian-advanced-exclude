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

afterEach(async () => {
  await evalInObsidian({
    async callback({ app, PLUGIN_ID: pluginId }) {
      app.setting.close();
      // `close` does not wait for the tab's hide, which writes the text still waiting to be saved: it would land after
      // the removal below and leave the file for the next test.
      await (app.setting.pluginTabs.find((tab) => tab.id === pluginId) as PluginSettingsTab | undefined)?.hideAsync();
      try {
        await app.vault.adapter.remove('.obsidianignore');
      } catch {
        // Ignore
      }
    },
    input: { PLUGIN_ID },
    vaultPath: getTemporaryVault().path
  });
});

describe('Pattern validation', () => {
  it('shows the finding of a bad line typed into the local patterns, in the error color', async () => {
    const result = await evalInObsidian({
      async callback({
        app,
        lib: { pressKey, waitUntil },
        PLUGIN_ID: pluginId,
        SETTLE_DELAY_IN_MS: settleDelay
      }) {
        const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId) as PluginSettingsTab | undefined;
        if (!settingTab) {
          return { error: 'Settings tab not found' };
        }
        app.setting.open();
        app.setting.openTabById(pluginId);

        function getItem(): Element | undefined {
          const items = [...(settingTab?.containerEl.querySelectorAll('.setting-item') ?? [])];
          return items.find((el) => el.querySelector('.setting-item-name')?.textContent === 'Local patterns');
        }

        await waitUntil({
          message: 'the Local patterns text area',
          predicate: () => !!getItem()?.querySelector('textarea'),
          timeoutInMilliseconds: settleDelay
        });
        const textArea = getItem()?.querySelector('textarea');
        if (!textArea) {
          return { error: 'Local patterns text area not found' };
        }
        const findingsBefore = getItem()?.querySelector('.advanced-exclude-pattern-findings')?.textContent ?? null;

        textArea.focus();
        textArea.setSelectionRange(textArea.value.length, textArea.value.length);
        for (const key of '\nbroken[') {
          await pressKey({ key: key === '\n' ? 'Enter' : key });
        }
        await waitUntil({
          message: 'the finding of the typed line',
          predicate: () => !!getItem()?.querySelector('.advanced-exclude-pattern-finding-error'),
          timeoutInMilliseconds: settleDelay
        });
        const findingEl = getItem()?.querySelector('.advanced-exclude-pattern-finding-error');
        const errorColor = getComputedStyle(document.body).getPropertyValue('--text-error').trim();
        const probeEl = document.body.createDiv();
        probeEl.style.color = errorColor;
        const expectedColor = getComputedStyle(probeEl).color;
        probeEl.remove();

        return {
          error: null,
          expectedColor,
          findingColor: findingEl ? getComputedStyle(findingEl).color : null,
          findingsBefore,
          findingText: findingEl?.textContent ?? null,
          lineCount: textArea.value.split('\n').length
        };
      },
      input: { PLUGIN_ID, SETTLE_DELAY_IN_MS },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();
    expect(result.findingsBefore).toBe('');
    expect(result.findingText).toBe(
      String.raw`Line ${String(result.lineCount)}: The [ at column 7 is never closed, so this line matches nothing. Write \[ for a bracket.`
    );
    expect(result.findingColor).toBe(result.expectedColor);
  });

  it('reports an error an outside edit of .obsidianignore brings, once, when the window regains focus', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, SETTLE_DELAY_IN_MS: settleDelay }) {
        function getNoticeTexts(): string[] {
          return [...document.querySelectorAll('.notice')].map((el) => el.textContent);
        }
        function countMatching(): number {
          return getNoticeTexts().filter((text) => text.includes('.obsidianignore, line 2')).length;
        }

        await app.vault.adapter.write('.obsidianignore', 'ok/\nbad[\n');
        window.dispatchEvent(new Event('focus'));
        await waitUntil({
          message: 'the notice for the bad line',
          predicate: () => countMatching() > 0,
          timeoutInMilliseconds: settleDelay
        });
        const noticeText = getNoticeTexts().find((text) => text.includes('.obsidianignore, line 2')) ?? null;

        // The same content again: nothing new to report.
        window.dispatchEvent(new Event('focus'));
        await sleep(1000);

        return { count: countMatching(), noticeText };
      },
      input: { SETTLE_DELAY_IN_MS },
      vaultPath: getTemporaryVault().path
    });

    expect(result.noticeText).toContain('.obsidianignore, line 2: The [ at column 4 is never closed, so this line matches nothing.');
    expect(result.count).toBe(1);
  });
});
