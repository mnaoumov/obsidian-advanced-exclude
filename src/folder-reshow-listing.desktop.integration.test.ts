import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

const PLUGIN_ID = 'advanced-exclude';
const SETTLE_DELAY_IN_MS = 3000;
const HIDDEN_FOLDER = 'folder-reshow-listing';
const SUBFOLDER = 'folder-reshow-listing/inner';
const NOTE_PATHS = ['folder-reshow-listing/one.md', 'folder-reshow-listing/inner/two.md', 'folder-reshow-listing/inner/three.md'];

interface AdapterInternals {
  readonly files: Record<string, unknown>;
  trigger: (name: string, path: string, ...rest: unknown[]) => void;
}

interface ManualIndexHiderInternals {
  readonly snapshots: Map<string, unknown>;
}

interface PluginWithSettingsComponent {
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface TraversableComponent {
  readonly _children?: readonly unknown[];
  readonly manualIndexHider?: ManualIndexHiderInternals;
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

describe('re-showing a folder hidden by an earlier session', () => {
  it('creates each of its files once, not once by the folder listing and again by its own chunk', async () => {
    const result = await evalInObsidian({
      async callback({ app, HIDDEN_FOLDER: hiddenFolder, NOTE_PATHS: notePaths, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay, SUBFOLDER: subfolder }) {
        const plugin = app.plugins.getPlugin(pluginId) as null | PluginWithSettingsComponent;
        if (!plugin) {
          return { error: 'Plugin not loaded' };
        }

        await app.vault.adapter.mkdir(subfolder);
        for (const notePath of notePaths) {
          await app.vault.adapter.write(notePath, `content of ${notePath}`);
        }
        await sleep(settleDelay);

        await plugin.pluginSettingsComponent.editAndSave((settings) => {
          settings.ignorePatterns = `${hiddenFolder}/\n`;
        });
        await sleep(settleDelay);
        const visibleWhileHidden = notePaths.filter((notePath) => app.vault.getAbstractFileByPath(notePath) !== null);

        // The state an app start leaves: the folder is hidden, this session holds no snapshot of it, and the adapter
        // holds no record of anything under it, because the startup scan never reconciled an ignored path.
        const hider = findManualIndexHider(plugin);
        if (!hider) {
          return { error: 'ManualIndexHider not found' };
        }
        hider.snapshots.clear();
        // This runs inside Obsidian, where no import is available, so the internals are typed through `unknown`.
        const adapterValue: unknown = app.vault.adapter;
        const adapter = adapterValue as AdapterInternals;
        for (const path of Object.keys(adapter.files)) {
          if (path === hiddenFolder || path.startsWith(`${hiddenFolder}/`)) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- reproduces the adapter state after an app start.
            delete adapter.files[path];
          }
        }

        const createdCounts: Record<string, number> = {};
        const originalTrigger = adapter.trigger;
        adapter.trigger = function trigger(this: AdapterInternals, name: string, path: string, ...rest: unknown[]): void {
          if (name === 'file-created') {
            createdCounts[path] = (createdCounts[path] ?? 0) + 1;
          }
          originalTrigger.call(this, name, path, ...rest);
        };
        try {
          await plugin.pluginSettingsComponent.editAndSave((settings) => {
            settings.ignorePatterns = '';
          });
          await sleep(settleDelay);
        } finally {
          adapter.trigger = originalTrigger;
        }

        const visibleAfterReShow = notePaths.filter((notePath) => app.vault.getAbstractFileByPath(notePath) !== null);
        return {
          createdCounts: Object.fromEntries(notePaths.map((notePath) => [notePath, createdCounts[notePath] ?? 0])),
          error: null,
          visibleAfterReShow,
          visibleWhileHidden
        };

        function findManualIndexHider(root: unknown): ManualIndexHiderInternals | undefined {
          if (typeof root !== 'object' || root === null) {
            return undefined;
          }
          const component = root as TraversableComponent;
          if (component.manualIndexHider) {
            return component.manualIndexHider;
          }
          for (const child of component._children ?? []) {
            const found = findManualIndexHider(child);
            if (found) {
              return found;
            }
          }
          return undefined;
        }
      },
      input: {
        HIDDEN_FOLDER,
        NOTE_PATHS,
        PLUGIN_ID,
        SETTLE_DELAY_IN_MS,
        SUBFOLDER
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result).toEqual({
      createdCounts: Object.fromEntries(NOTE_PATHS.map((notePath) => [notePath, 1])),
      error: null,
      visibleAfterReShow: NOTE_PATHS,
      visibleWhileHidden: []
    });
  });
});
