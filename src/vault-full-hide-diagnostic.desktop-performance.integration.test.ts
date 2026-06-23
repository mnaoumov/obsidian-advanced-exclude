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
 * Regression guard for the Full-mode hide (S6, direct index mutation): the hide no
 * longer calls `reconcileDeletion`, so Obsidian's per-file `updateRelatedLinks`
 * cascade — which scanned the whole vault once per deleted file (the original O(N²),
 * ~16 min at 90k) — never runs at all. This test wraps `updateRelatedLinks` with a
 * counter and asserts a whole-folder hide produces **zero** real calls (not "one
 * batched call", not "one per file"), proving the cascade is gone. If anyone
 * reintroduces a reconcile-based hide, this fails. Size is `AE_PERF_VAULT_SIZE`
 * (default 90k); see scripts/helpers/generate-performance-vault.ts.
 */

interface TraversableComponent {
  readonly _children?: readonly unknown[];
}

const PLUGIN_ID = 'advanced-exclude';
const VAULT_FOLDER = 'big';

const SETTLE_DELAY_IN_MS = 5000;
const INDEX_POLL_IN_MS = 5000;
const INDEX_WAIT_IN_MS = 300_000;
const SCENARIO_TIMEOUT_IN_MS = 595_000;

describe('Full-mode hide fires no updateRelatedLinks cascade', () => {
  it('issues zero real updateRelatedLinks calls for a whole-folder hide', async () => {
    const result = await evalInObsidian({
      args: {
        fullMode: ExcludeMode.Full,
        INDEX_POLL_IN_MS,
        INDEX_WAIT_IN_MS,
        PLUGIN_ID,
        SETTLE_DELAY_IN_MS,
        VAULT_FOLDER
      },
      async fn({
        app,
        fullMode,
        INDEX_POLL_IN_MS: pollMs,
        INDEX_WAIT_IN_MS: indexWaitMs,
        PLUGIN_ID: pluginId,
        SETTLE_DELAY_IN_MS: settleDelay,
        VAULT_FOLDER: vaultFolder
      }) {
        const scopePrefix = `${vaultFolder}/`;

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
          return { error: 'Plugin not loaded', indexedCount, realUpdateRelatedLinksCalls: -1, remainingInScope: -1 };
        }

        const ignorePatternsComponent = findComponent(plugin, 'IgnorePatternsComponent') as IgnorePatternsComponent | undefined;
        const pluginSettingsComponent = findComponent(plugin, 'PluginSettingsComponent') as PluginSettingsComponent | undefined;
        if (!ignorePatternsComponent || !pluginSettingsComponent) {
          return { error: 'Could not locate plugin components', indexedCount, realUpdateRelatedLinksCalls: -1, remainingInScope: -1 };
        }

        /*
         * Count real updateRelatedLinks calls. S6 removes files from the index
         * directly (no reconcileDeletion), so nothing inside the hide reaches this
         * wrapper — a correct hide leaves the counter at zero.
         */
        const metadataCache = app.metadataCache;
        const originalUpdateRelatedLinks = metadataCache.updateRelatedLinks.bind(metadataCache);
        let realUpdateRelatedLinksCalls = 0;
        metadataCache.updateRelatedLinks = (namesOrPath: string | string[]): void => {
          realUpdateRelatedLinksCalls++;
          originalUpdateRelatedLinks([namesOrPath].flat());
        };

        try {
          await pluginSettingsComponent.editAndSave((settings) => {
            settings.excludeMode = fullMode;
            settings.obsidianIgnoreContent = `${vaultFolder}/\n`;
          });
          await ignorePatternsComponent.processConfigChanges();
        } finally {
          metadataCache.updateRelatedLinks = originalUpdateRelatedLinks;
        }

        return {
          error: null,
          indexedCount,
          realUpdateRelatedLinksCalls,
          remainingInScope: countInScope()
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
    // The whole vault was populated and indexed before the hide.
    expect(result.indexedCount).toBeGreaterThan(0);
    // Full mode removed the ignored subtree from Obsidian's index.
    expect(result.remainingInScope).toBe(0);
    // S6 hides without reconcileDeletion, so the updateRelatedLinks cascade never fires.
    expect(result.realUpdateRelatedLinksCalls).toBe(0);
  }, SCENARIO_TIMEOUT_IN_MS);
});
