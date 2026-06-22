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
 * Regression guard for the Full-mode hide O(N²) fix: Obsidian calls
 * `MetadataCache.updateRelatedLinks` once per deleted file during the
 * `reconcileDeletion` cascade, and each call scans the whole vault. The plugin
 * batches these — suppressing the per-file calls during the bulk hide and issuing
 * one call at the end — turning a ~16 min 90k hide into ~9 s. This test wraps
 * `updateRelatedLinks` with a counting pass-through and asserts the cascade
 * produced exactly one real call (the batched flush), not one per file. Size is
 * `AE_PERF_VAULT_SIZE` (default 90k); see scripts/helpers/generate-performance-vault.ts.
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

describe('Full-mode hide batches updateRelatedLinks', () => {
  it('issues one real updateRelatedLinks call for the whole folder, not one per file', async () => {
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
         * Count real updateRelatedLinks calls. The plugin's batching replaces the
         * method during the hide with a collector, then restores this wrapper and
         * calls it once with the union — so a batched hide lands here exactly once.
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
    // The cascade's per-file calls were batched into exactly one real call.
    expect(result.realUpdateRelatedLinksCalls).toBe(1);
  }, SCENARIO_TIMEOUT_IN_MS);
});
