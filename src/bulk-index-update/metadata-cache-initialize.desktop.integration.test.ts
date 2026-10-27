import type { MetadataCache } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

const PLUGIN_ID = 'advanced-exclude';
const SETTLE_DELAY_IN_MS = 3000;
const HIDDEN_FOLDER = 'metadata-cache-initialize';
const NOTE_PATHS = ['metadata-cache-initialize/one.md', 'metadata-cache-initialize/two.md', 'metadata-cache-initialize/three.md'];

interface PluginWithSettingsComponent {
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

afterEach(async () => {
  await evalInObsidian({
    async callback({ app, HIDDEN_FOLDER: hiddenFolder, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay }) {
      // Back to the default settings and an empty ignore file, so nothing leaks into the suites sharing this vault.
      await app.plugins.disablePluginAndSave(pluginId);
      try {
        await app.vault.adapter.remove(`${app.vault.configDir}/plugins/${pluginId}/data.json`);
      } catch {
        // Ignore
      }
      await app.vault.adapter.write('.obsidianignore', '');
      try {
        await app.vault.adapter.rmdir(hiddenFolder, true);
      } catch {
        // Ignore
      }
      await app.plugins.enablePluginAndSave(pluginId);
      await sleep(settleDelay);
    },
    input: {
      HIDDEN_FOLDER,
      PLUGIN_ID,
      SETTLE_DELAY_IN_MS
    },
    vaultPath: getTemporaryVault().path
  });
});

describe('metadataCache.initialize with paths hidden', () => {
  it('runs no per-path related-links pass for the hidden paths it purges', async () => {
    const result = await evalInObsidian({
      async callback({ app, HIDDEN_FOLDER: hiddenFolder, NOTE_PATHS: notePaths, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay }) {
        const plugin = app.plugins.getPlugin(pluginId) as null | PluginWithSettingsComponent;
        if (!plugin) {
          return { error: 'plugin not loaded' };
        }

        await app.vault.adapter.mkdir(hiddenFolder);
        for (const notePath of notePaths) {
          await app.vault.adapter.write(notePath, `content of ${notePath}`);
        }
        await sleep(settleDelay);
        const { metadataCache } = app;
        const cacheRows = new Map<string, (typeof metadataCache.fileCache)[string] | undefined>();
        for (const notePath of notePaths) {
          cacheRows.set(notePath, metadataCache.fileCache[notePath]);
        }

        await plugin.pluginSettingsComponent.editAndSave((settings) => {
          settings.ignorePatterns = `${hiddenFolder}/\n`;
        });
        await sleep(settleDelay);
        const visibleWhileHidden = notePaths.filter((notePath) => app.vault.getAbstractFileByPath(notePath) !== null);

        // At an app start `initialize` walks the cache rows `preload` read from IndexedDB, and purges each one whose path
        // the vault did not load: in `Full` mode, every hidden path. Each purge calls `updateRelatedLinks`, which walks every
        // cached file's links, unless the plugin batches them. The hide dropped the rows from memory, so putting them back
        // and running `initialize` again takes the same purge without an app reload. Its listener registration and the
        // unique-name index it refills are stubbed, so the second run leaves no duplicate behind in the shared instance.
        for (const [notePath, cacheRow] of cacheRows) {
          if (cacheRow) {
            metadataCache.fileCache[notePath] = cacheRow;
          }
        }
        const restoreStubs = [
          stubOwnMethod(metadataCache, 'watchVaultChanges', () => undefined),
          stubOwnMethod(metadataCache.uniqueFileLookup, 'add', () => undefined)
        ];
        const relatedLinksNames: string[] = [];

        const originalUpdateRelatedLinks = metadataCache.updateRelatedLinks;
        restoreStubs.push(stubOwnMethod(metadataCache, 'updateRelatedLinks', function updateRelatedLinks(this: MetadataCache, fileNames: string[]): void {
          relatedLinksNames.push(...fileNames);
          originalUpdateRelatedLinks.call(this, fileNames);
        }));
        try {
          await metadataCache.initialize();
        } finally {
          for (const restore of restoreStubs.reverse()) {
            restore();
          }
        }

        const hiddenNames = new Set(notePaths.map((notePath) => notePath.slice(notePath.lastIndexOf('/') + 1)));
        const perPathPasses = relatedLinksNames.filter((name) => hiddenNames.has(name)).length;
        return { error: null, perPathPasses, rowsCaptured: [...cacheRows.values()].filter(Boolean).length, visibleWhileHidden };

        function stubOwnMethod(target: object, key: string, stub: unknown): () => void {
          const record = target as Record<string, unknown>;
          const isHadOwn = Object.hasOwn(record, key);
          const original = record[key];
          record[key] = stub;
          return () => {
            if (isHadOwn) {
              record[key] = original;
            } else {
              // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- drops the own stub so the prototype method shows through again.
              delete record[key];
            }
          };
        }
      },
      input: {
        HIDDEN_FOLDER,
        NOTE_PATHS,
        PLUGIN_ID,
        SETTLE_DELAY_IN_MS
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result).toEqual({
      error: null,
      perPathPasses: 0,
      rowsCaptured: NOTE_PATHS.length,
      visibleWhileHidden: []
    });
  });
});
