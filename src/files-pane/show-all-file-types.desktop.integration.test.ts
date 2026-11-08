import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

interface Snapshot {
  readonly displayed: null | string[];
  readonly indexed: string[];
}

const PLUGIN_ID = 'advanced-exclude';
const SETTLE_DELAY_IN_MS = 3000;
const FOLDER = 'show-all-file-types';
const IGNORED_UNSUPPORTED_FILE = 'show-all-file-types/ignored.xyz';
const IGNORED_IMAGE_FILE = 'show-all-file-types/ignored.png';
const VISIBLE_UNSUPPORTED_FILE = 'show-all-file-types/visible.abc';
const VISIBLE_NOTE = 'show-all-file-types/visible.md';

afterEach(async () => {
  await evalInObsidian({
    async callback({ app, FOLDER: folder, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay }) {
      // Back to the default settings, Obsidian's default `Show all file types` and an empty ignore file.
      app.vault.setConfig('showUnsupportedFiles', false);
      const dataPath = `${app.vault.configDir}/plugins/${pluginId}/data.json`;
      await app.plugins.disablePluginAndSave(pluginId);
      try {
        await app.vault.adapter.remove(dataPath);
      } catch {
        // Ignore
      }
      await app.vault.adapter.write('.obsidianignore', '');
      try {
        await app.vault.adapter.rmdir(folder, true);
      } catch {
        // Ignore
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
});

describe('`Show all file types` does not bring ignored files back (discussion #9)', () => {
  it.each(['Full', 'FilesPane'])('in %s mode', async (excludeMode) => {
    const result = await evalInObsidian({
      async callback({
        app,
        EXCLUDE_MODE: mode,
        FOLDER: folder,
        IGNORED_IMAGE_FILE: ignoredImageFile,
        IGNORED_UNSUPPORTED_FILE: ignoredUnsupportedFile,
        PLUGIN_ID: pluginId,
        SETTLE_DELAY_IN_MS: settleDelay,
        VISIBLE_NOTE: visibleNote,
        VISIBLE_UNSUPPORTED_FILE: visibleUnsupportedFile
      }) {
        function getView(): FileExplorerView | undefined {
          return app.workspace.getLeavesOfType('file-explorer')[0]?.view as FileExplorerView | undefined;
        }

        // The paths the explorer lists AND displays: an item for an unsupported file exists either way, and
        // `Show all file types` only decides whether it is displayed.
        function displayedPaths(): null | string[] {
          const view = getView();
          return view?.fileItems
            ? Object.entries(view.fileItems)
              .filter(([, item]) => !('shouldDisplay' in item) || (item.shouldDisplay as () => boolean)())
              .map(([path]) => path)
              .sort()
            : null;
        }

        function snapshot(): Snapshot {
          return {
            displayed: displayedPaths(),
            indexed: app.vault.getAllLoadedFiles().map((file) => file.path).filter((path) => path.startsWith(folder))
              .sort()
          };
        }

        if (app.workspace.getLeavesOfType('file-explorer').length === 0) {
          await app.workspace.getLeftLeaf(false)?.setViewState({ type: 'file-explorer' });
        }

        app.vault.setConfig('showUnsupportedFiles', false);
        await app.vault.adapter.mkdir(folder);
        await app.vault.adapter.write(ignoredUnsupportedFile, 'ignored');
        await app.vault.adapter.write(ignoredImageFile, 'ignored');
        await app.vault.adapter.write(visibleUnsupportedFile, 'visible');
        await app.vault.adapter.write(visibleNote, 'visible');
        await sleep(settleDelay);

        await app.plugins.disablePluginAndSave(pluginId);
        await app.vault.adapter.write(
          `${app.vault.configDir}/plugins/${pluginId}/data.json`,
          JSON.stringify({ excludeMode: mode, ignorePatterns: '*.xyz\n*.png\n' })
        );
        await app.plugins.enablePluginAndSave(pluginId);
        await sleep(settleDelay);
        const before = snapshot();

        app.vault.setConfig('showUnsupportedFiles', true);
        await sleep(settleDelay);
        const shown = snapshot();

        app.vault.setConfig('showUnsupportedFiles', false);
        await sleep(settleDelay);
        const after = snapshot();

        return { after, before, shown };
      },
      input: {
        EXCLUDE_MODE: excludeMode,
        FOLDER,
        IGNORED_IMAGE_FILE,
        IGNORED_UNSUPPORTED_FILE,
        PLUGIN_ID,
        SETTLE_DELAY_IN_MS,
        VISIBLE_NOTE,
        VISIBLE_UNSUPPORTED_FILE
      },
      vaultPath: getTemporaryVault().path
    });

    for (const state of [result.before, result.shown, result.after]) {
      expect(state.displayed).toContain(VISIBLE_NOTE);
      expect(state.displayed).not.toContain(IGNORED_UNSUPPORTED_FILE);
      expect(state.displayed).not.toContain(IGNORED_IMAGE_FILE);
    }
    // Turning `Show all file types` on shows the unsupported files that no pattern ignores...
    expect(result.shown.displayed).toContain(VISIBLE_UNSUPPORTED_FILE);
    // ...and off hides them again.
    expect(result.after.displayed).not.toContain(VISIBLE_UNSUPPORTED_FILE);

    if (excludeMode === 'Full') {
      // In `Full` mode the ignored files are not indexed at all, whatever the setting.
      for (const state of [result.before, result.shown, result.after]) {
        expect(state.indexed).not.toContain(IGNORED_UNSUPPORTED_FILE);
        expect(state.indexed).not.toContain(IGNORED_IMAGE_FILE);
      }
    }
  });
});
