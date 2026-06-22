import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { ExcludeMode } from './plugin-settings.ts';

/*
 * End-to-end hide of the maintainer's real vault size (~90,000 notes), in real
 * Obsidian. It runs in `FilesPane` mode on purpose: `Full` mode removes every file
 * from Obsidian's index via `reconcileDeletion`, whose internal cascade is O(N²)
 * (~16 min at 90k — an Obsidian limitation, not the plugin, which issues exactly
 * one deletion per hide-root). `FilesPane` mode removes from the explorer DOM
 * (`onDelete`), which is O(N) — ~0.8 s at 90k — so it is the practical path for huge
 * vaults. The `Full`-mode algorithm is covered at 90k/1M in
 * `vault-model-scaling.no-app.integration.test.ts`.
 */

interface TraversableComponent {
  readonly _children?: readonly unknown[];
}

const PLUGIN_ID = 'advanced-exclude';
// Must match scripts/helpers/generate-performance-vault.ts (the populate spec).
const VAULT_FOLDER = 'big';
const VAULT_CONTROL = 'keep-real.md';

const SETTLE_DELAY_IN_MS = 5000;
const INDEX_POLL_IN_MS = 5000;
const INDEX_WAIT_IN_MS = 300_000;
// A real vault, not a fluke: the populate spec writes tens of thousands of notes.
const MIN_EXPECTED_FILES = 1000;
const SCENARIO_TIMEOUT_IN_MS = 480_000;

describe('Real-scale vault — FilesPane mode', () => {
  it('hides the whole pre-populated vault folder from the explorer', async () => {
    const result = await evalInObsidian({
      args: {
        filesPaneMode: ExcludeMode.FilesPane,
        INDEX_POLL_IN_MS,
        INDEX_WAIT_IN_MS,
        PLUGIN_ID,
        SETTLE_DELAY_IN_MS,
        VAULT_CONTROL,
        VAULT_FOLDER
      },
      async fn({
        app,
        filesPaneMode,
        INDEX_POLL_IN_MS: pollMs,
        INDEX_WAIT_IN_MS: indexWaitMs,
        PLUGIN_ID: pluginId,
        SETTLE_DELAY_IN_MS: settleDelay,
        VAULT_CONTROL: controlPath,
        VAULT_FOLDER: vaultFolder
      }) {
        const scopePrefix = `${vaultFolder}/`;

        /*
         * Obsidian may still be finishing its startup scan; wait until the in-scope
         * count stops growing before driving the hide.
         */
        const deadline = Date.now() + indexWaitMs;
        let indexedCount = countInScope();
        while (Date.now() < deadline) {
          await sleep(pollMs);
          const next = countInScope();
          if (next === indexedCount) {
            break;
          }
          indexedCount = next;
        }
        await sleep(settleDelay);

        const plugin = app.plugins.getPlugin(pluginId);
        if (!plugin) {
          return { error: 'Plugin not loaded', explorerVisibleInScope: -1, indexedCount, isControlInExplorer: false };
        }

        const ignorePatternsComponent = findComponent(plugin, 'IgnorePatternsComponent') as IgnorePatternsComponent | undefined;
        const pluginSettingsComponent = findComponent(plugin, 'PluginSettingsComponent') as PluginSettingsComponent | undefined;
        if (!ignorePatternsComponent || !pluginSettingsComponent) {
          return { error: 'Could not locate plugin components', explorerVisibleInScope: -1, indexedCount, isControlInExplorer: false };
        }

        await pluginSettingsComponent.editAndSave((settings) => {
          settings.excludeMode = filesPaneMode;
          settings.obsidianIgnoreContent = `${vaultFolder}/\n`;
        });
        await ignorePatternsComponent.processConfigChanges();
        await sleep(settleDelay);

        const fileExplorerView = app.workspace.getLeavesOfType('file-explorer')[0]?.view as FileExplorerView | undefined;
        const explorerPaths = fileExplorerView?.fileItems ? Object.keys(fileExplorerView.fileItems) : [];
        return {
          error: null,
          explorerVisibleInScope: explorerPaths.filter((path) => path.startsWith(scopePrefix)).length,
          indexedCount,
          isControlInExplorer: explorerPaths.includes(controlPath)
        };

        function countInScope(): number {
          return app.vault.getFiles().filter((file) => file.path.startsWith(scopePrefix)).length;
        }

        function findComponent(root: object, className: string): unknown {
          if (root.constructor.name === className) {
            return root;
          }
          for (const child of (root as TraversableComponent)._children ?? []) {
            if (typeof child === 'object' && child !== null) {
              const found = findComponent(child, className);
              if (found) {
                return found;
              }
            }
          }
          return undefined;
        }
      },
      vaultPath: getTempVault().path
    });

    expect(result.error).toBeNull();
    // The vault really was populated and indexed before the test ran.
    expect(result.indexedCount).toBeGreaterThanOrEqual(MIN_EXPECTED_FILES);
    // Every note under the ignored folder is gone from the file explorer.
    expect(result.explorerVisibleInScope).toBe(0);
    // The sibling note outside the pattern stays in the explorer.
    expect(result.isControlInExplorer).toBe(true);
  }, SCENARIO_TIMEOUT_IN_MS);
});
