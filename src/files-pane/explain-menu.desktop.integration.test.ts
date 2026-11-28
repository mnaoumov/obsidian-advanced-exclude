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

import { ExcludeMode } from '../settings/plugin-settings.ts';

const PLUGIN_ID = 'advanced-exclude';
const SETTLE_DELAY_IN_MS = 3000;
const FOLDER = 'explain-menu-test';
const KEPT_FILE = 'explain-menu-test/keep.md';
const OTHER_FILE = 'explain-menu-test/other.md';
const PATTERNS = '/explain-menu-test/*\n!/explain-menu-test/keep.md\n';

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
      // Back to the default settings, so nothing leaks into the suites sharing this vault.
      await app.plugins.disablePluginAndSave(pluginId);
      try {
        await app.vault.adapter.remove(`${app.vault.configDir}/plugins/${pluginId}/data.json`);
      } catch {
        // Ignore
      }
      try {
        await app.vault.adapter.rmdir(folder, true);
      } catch {
        // Ignore
      }
      for (const noticeEl of document.body.querySelectorAll('.notice')) {
        noticeEl.remove();
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

interface ExplainResult {
  readonly error: null | string;
  readonly lines: readonly string[];
}

/**
 * Builds the folder under {@link PATTERNS} in the `Files pane` mode, which leaves the excluded file in the vault, then
 * clicks `Why is this excluded?` in the Files pane menu of {@link targetPath} and reads the notice it shows.
 */
async function explainFromMenu(targetPath: string): Promise<ExplainResult> {
  return await evalInObsidian({
    async callback({
      app,
      EXCLUDE_MODE: excludeMode,
      FOLDER: folder,
      KEPT_FILE: keptFile,
      obsidianModule,
      OTHER_FILE: otherFile,
      PATTERNS: patterns,
      PLUGIN_ID: pluginId,
      SETTLE_DELAY_IN_MS: settleDelay,
      TARGET_PATH: path
    }) {
      await app.vault.adapter.mkdir(folder);
      await app.vault.adapter.write(keptFile, 'keep');
      await app.vault.adapter.write(otherFile, 'other');
      await sleep(settleDelay);

      const plugin = app.plugins.getPlugin(pluginId) as null | PluginWithSettingsComponent;
      if (!plugin) {
        return { error: 'Plugin is not loaded', lines: [] };
      }
      await plugin.pluginSettingsComponent.editAndSave((settings) => {
        settings.excludeMode = excludeMode;
        settings.ignorePatterns = patterns;
      });
      await sleep(settleDelay);

      const target = app.vault.getAbstractFileByPath(path);
      if (!target) {
        return { error: `${path} is not in the vault`, lines: [] };
      }
      const menu = new obsidianModule.Menu();
      app.workspace.trigger('file-menu', menu, target, 'file-explorer-context-menu');
      // Items is internal: the public typings leave it out.
      const items = Reflect.get(menu, 'items') as readonly RealMenuItem[];
      const item = items.find((menuItem) => menuItem.titleEl.textContent === 'Why is this excluded?');
      if (!item?.callback) {
        menu.hide();
        return { error: `No item in ${items.map((menuItem) => menuItem.titleEl.textContent).join(', ')}`, lines: [] };
      }
      item.callback();
      menu.hide();

      const explanationEls = [...document.body.querySelectorAll('.advanced-exclude-explanation')];
      const explanationEl = explanationEls.at(-1);
      if (!explanationEl) {
        return { error: 'No explanation notice', lines: [] };
      }
      const lines = [...explanationEl.querySelectorAll('.advanced-exclude-explanation-line')].map((lineEl) => lineEl.textContent);
      return { error: null, lines };
    },
    input: {
      EXCLUDE_MODE: ExcludeMode.FilesPane,
      FOLDER,
      KEPT_FILE,
      OTHER_FILE,
      PATTERNS,
      PLUGIN_ID,
      SETTLE_DELAY_IN_MS,
      TARGET_PATH: targetPath
    },
    vaultPath: getTemporaryVault().path
  });
}

describe('Why is this excluded?', () => {
  it('names the line that excludes a file', async () => {
    const result = await explainFromMenu(OTHER_FILE);
    expect(result.error).toBeNull();
    expect(result.lines[0]).toBe(`The file ${OTHER_FILE} is excluded: hidden from the Files pane.`);
    expect(result.lines).toContain(`Patterns: excluded by /${FOLDER}/*, line 1 of the global patterns.`);
  });

  it('names the ! line that brought a file back, and the line it overrode', async () => {
    const result = await explainFromMenu(KEPT_FILE);
    expect(result.error).toBeNull();
    expect(result.lines[0]).toBe(`The file ${KEPT_FILE} is not excluded.`);
    expect(result.lines).toContain(`Patterns: brought back by !/${KEPT_FILE}, line 2 of the global patterns.`);
    expect(result.lines).toContain(`It overrides /${FOLDER}/*, line 1 of the global patterns.`);
  });
});
