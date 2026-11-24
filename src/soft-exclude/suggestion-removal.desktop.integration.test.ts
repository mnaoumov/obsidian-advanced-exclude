import type { EditorSuggestContext } from 'obsidian';

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

interface SuggestedFile {
  readonly path?: string;
}

interface SuggestionWithFile {
  readonly file?: null | SuggestedFile;
}

const PLUGIN_ID = 'advanced-exclude';
const SETTLE_DELAY_IN_MS = 3000;
const TEST_FOLDER = 'suggestion-removal';

afterEach(async () => {
  await evalInObsidian({
    async callback({ app, FULL_MODE: fullMode, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay, TEST_FOLDER: folder }) {
      const plugin = app.plugins.getPlugin(pluginId) as null | PluginWithSettingsComponent;
      await plugin?.pluginSettingsComponent.editAndSave((settings) => {
        settings.excludeMode = fullMode;
        settings.ignorePatterns = '';
        settings.shouldRemoveFromLinkSuggestions = false;
        settings.shouldRemoveFromQuickSwitcher = false;
      });
      await sleep(settleDelay);
      app.workspace.detachLeavesOfType('markdown');
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

describe('Removing soft-excluded files from suggestions', () => {
  it('leaves them out of the quick switcher and link suggestions only while the toggles are on', async () => {
    const result = await evalInObsidian({
      async callback({ app, obsidianModule, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay, SOFT_MODE: softMode, TEST_FOLDER: folder }) {
        const plugin = app.plugins.getPlugin(pluginId) as null | PluginWithSettingsComponent;
        if (!plugin) {
          return { error: 'Plugin not loaded' };
        }
        const switcher = app.internalPlugins.getPluginById('switcher')?.instance;
        if (!switcher) {
          return { error: 'No quick switcher' };
        }
        const linkSuggest = app.workspace.editorSuggest.suggests.find((suggest) => 'suggestManager' in suggest);
        if (!linkSuggest) {
          return { error: 'No link suggest' };
        }
        const dropPath = `${folder}/suggested-drop.md`;
        const keepPath = `${folder}/suggested-keep.md`;
        const sourcePath = `${folder}/source.md`;

        async function edit(editor: (settings: PluginSettings) => void): Promise<void> {
          await plugin?.pluginSettingsComponent.editAndSave(editor);
          await sleep(settleDelay);
        }

        function suggestionPath(suggestion: unknown): null | string {
          const file = (suggestion as null | SuggestionWithFile)?.file;
          return file?.path ?? null;
        }

        await app.vault.adapter.mkdir(folder);
        await app.vault.adapter.write(dropPath, 'drop');
        await app.vault.adapter.write(keepPath, 'keep');
        await app.vault.adapter.write(sourcePath, 'source');
        await sleep(settleDelay);

        const sourceFile = app.vault.getFileByPath(sourcePath);
        if (!sourceFile) {
          return { error: 'No source file' };
        }
        const leaf = app.workspace.getLeaf(true);
        await leaf.openFile(sourceFile);
        if (!(leaf.view instanceof obsidianModule.MarkdownView)) {
          return { error: 'No markdown view' };
        }
        const { editor } = leaf.view;
        const switcherInstance = switcher;
        const fileSuggest = linkSuggest;
        const contextFile = sourceFile;

        async function snapshot(): Promise<Record<string, string[]>> {
          const modal = new switcherInstance.QuickSwitcherModal(app, switcherInstance.options);
          const switcherPaths = modal.getSuggestions('suggested').map((suggestion) => suggestionPath(suggestion));
          const context: EditorSuggestContext = {
            editor,
            end: { ch: 5, line: 0 },
            file: contextFile,
            query: 'suggested',
            start: { ch: 2, line: 0 }
          };
          const linkSuggestions = await fileSuggest.getSuggestions(context);
          const linkPaths = linkSuggestions.map((suggestion) => suggestionPath(suggestion));
          return {
            link: linkPaths.filter((path): path is string => path?.startsWith(folder) ?? false).sort(),
            switcher: switcherPaths.filter((path): path is string => path?.startsWith(folder) ?? false).sort()
          };
        }

        await edit((settings) => {
          settings.excludeMode = softMode;
          settings.ignorePatterns = `${dropPath}\n`;
        });
        const toggledOff = await snapshot();

        await edit((settings) => {
          settings.shouldRemoveFromQuickSwitcher = true;
        });
        const switcherOn = await snapshot();

        await edit((settings) => {
          settings.shouldRemoveFromLinkSuggestions = true;
        });
        const bothOn = await snapshot();

        return { bothOn, error: null, switcherOn, toggledOff };
      },
      input: { PLUGIN_ID, SETTLE_DELAY_IN_MS, SOFT_MODE: ExcludeMode.Soft, TEST_FOLDER },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();
    const dropPath = `${TEST_FOLDER}/suggested-drop.md`;
    const keepPath = `${TEST_FOLDER}/suggested-keep.md`;

    // Off: Obsidian only ranks the soft-excluded file lower.
    expect(result.toggledOff).toEqual({ link: [dropPath, keepPath], switcher: [dropPath, keepPath] });
    expect(result.switcherOn).toEqual({ link: [dropPath, keepPath], switcher: [keepPath] });
    expect(result.bothOn).toEqual({ link: [keepPath], switcher: [keepPath] });
  });
});
