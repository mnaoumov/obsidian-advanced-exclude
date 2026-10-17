import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-exclude';
const SETTLE_DELAY_IN_MS = 3000;
const HIDDEN_FOLDER = 'files-pane-hidden';
const HIDDEN_FILE = 'files-pane-hidden/secret.md';
const VISIBLE_FILE = 'files-pane-visible.md';

afterEach(async () => {
  await evalInObsidian({
    async callback({ app, HIDDEN_FOLDER: hiddenFolder, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay, VISIBLE_FILE: visibleFile }) {
      // Back to the default settings and an empty ignore file, so nothing leaks into the suites sharing this vault.
      const dataPath = `${app.vault.configDir}/plugins/${pluginId}/data.json`;
      await app.plugins.disablePluginAndSave(pluginId);
      try {
        await app.vault.adapter.remove(dataPath);
      } catch {
        // Ignore
      }
      await app.vault.adapter.write('.obsidianignore', '');
      try {
        await app.vault.adapter.rmdir(hiddenFolder, true);
      } catch {
        // Ignore
      }
      try {
        await app.vault.adapter.remove(visibleFile);
      } catch {
        // Ignore
      }
      await app.plugins.enablePluginAndSave(pluginId);
      if (app.workspace.getLeavesOfType('file-explorer').length === 0) {
        await app.workspace.getLeftLeaf(false)?.setViewState({ type: 'file-explorer' });
      }
      await sleep(settleDelay);
    },
    input: {
      HIDDEN_FOLDER,
      PLUGIN_ID,
      SETTLE_DELAY_IN_MS,
      VISIBLE_FILE
    },
    vaultPath: getTemporaryVault().path
  });
});

describe('Files Pane mode — an explorer built after the plugin loaded', () => {
  it('does not list ignored files (the restart / deferred-leaf case)', async () => {
    const result = await evalInObsidian({
      async callback({
        app,
        HIDDEN_FILE: hiddenFile,
        HIDDEN_FOLDER: hiddenFolder,
        PLUGIN_ID: pluginId,
        SETTLE_DELAY_IN_MS: settleDelay,
        VISIBLE_FILE: visibleFile
      }) {
        function explorerPaths(): null | string[] {
          const view = app.workspace.getLeavesOfType('file-explorer')[0]?.view as FileExplorerView | undefined;
          return view?.fileItems ? Object.keys(view.fileItems).sort() : null;
        }

        await app.vault.adapter.mkdir(hiddenFolder);
        await app.vault.adapter.write(hiddenFile, 'secret');
        await app.vault.adapter.write(visibleFile, 'visible');
        await sleep(settleDelay);

        // Load the plugin while no explorer exists — what a restart looks like, since Obsidian builds the
        // explorer after plugins load, and what a deferred explorer leaf looks like until it is revealed.
        for (const leaf of app.workspace.getLeavesOfType('file-explorer')) {
          leaf.detach();
        }
        await app.plugins.disablePluginAndSave(pluginId);
        await app.vault.adapter.write(`${app.vault.configDir}/plugins/${pluginId}/data.json`, JSON.stringify({ excludeMode: 'FilesPane' }));
        await app.vault.adapter.write('.obsidianignore', `${hiddenFolder}/\n`);
        await app.plugins.enablePluginAndSave(pluginId);
        await sleep(settleDelay);

        // The new explorer fills itself from every loaded file.
        const leaf = app.workspace.getLeftLeaf(false);
        if (!leaf) {
          return { error: 'No left leaf', explorer: null, loaded: [] };
        }
        await leaf.setViewState({ type: 'file-explorer' });
        await app.workspace.revealLeaf(leaf);
        await sleep(settleDelay);

        return {
          error: null,
          explorer: explorerPaths(),
          loaded: app.vault.getAllLoadedFiles().map((file) => file.path)
        };
      },
      input: {
        HIDDEN_FILE,
        HIDDEN_FOLDER,
        PLUGIN_ID,
        SETTLE_DELAY_IN_MS,
        VISIBLE_FILE
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();
    // Files Pane mode leaves the index alone...
    expect(result.loaded).toContain(HIDDEN_FILE);
    // ...and hides the ignored files from the explorer only.
    expect(result.explorer).toContain(VISIBLE_FILE);
    expect(result.explorer).not.toContain(HIDDEN_FOLDER);
    expect(result.explorer).not.toContain(HIDDEN_FILE);
  });
});
