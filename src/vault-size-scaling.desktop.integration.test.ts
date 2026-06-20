import type { DataAdapterEx } from '@obsidian-typings/obsidian-public-latest';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

interface TraversableComponent {
  readonly _children?: readonly unknown[];
}

interface VaultSizeScenarioResult {
  readonly bulkVisibleAfterHide: number;
  readonly bulkVisibleAfterShow: number;
  readonly error: null | string;
  readonly isControlVisibleAfterHide: boolean;
  readonly reconcileDeletionCount: number;
}

const PLUGIN_ID = 'advanced-exclude';
const OBSIDIAN_IGNORE_FILE = '.obsidianignore';

/*
 * Vault sizes (number of files in the ignored folder) the scaling scenario runs
 * at. The point is to prove the hide cost is independent of folder size: a flat
 * folder always collapses to a single `reconcileDeletion` hide-root, whatever N.
 */
const SCENARIO_SIZES = [100, 1000, 3000];

/*
 * Files are created concurrently in batches to keep large-vault setup fast
 * without flooding the adapter with thousands of simultaneous writes.
 */
const CREATE_BATCH_SIZE = 50;

/*
 * Generous settle after a plugin reload / config change so the async model
 * build and projection update finish before assertions read the vault.
 */
const SETTLE_DELAY_IN_MS = 5000;

/*
 * A flat folder hidden by one pattern has exactly one hide-root, so the fixed
 * projection must issue exactly one `reconcileDeletion` no matter how many files
 * the folder holds. More than this means the per-descendant walk regressed.
 */
const EXPECTED_HIDE_ROOT_RECONCILE_DELETIONS = 1;

/*
 * Per-test timeout: building a multi-thousand-file vault plus a reload needs well
 * beyond the default 30 s desktop budget.
 */
const SCENARIO_TIMEOUT_IN_MS = 180_000;

function settle(settleDelay: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, settleDelay);
  });
}

afterEach(async () => {
  await evalInObsidian({
    args: {
      OBSIDIAN_IGNORE_FILE,
      SCENARIO_SIZES
    },
    async fn({ app, OBSIDIAN_IGNORE_FILE: ignoreFile, SCENARIO_SIZES: sizes }) {
      try {
        await app.vault.adapter.remove(ignoreFile);
      } catch {
        // Ignore — the ignore file may not exist.
      }
      for (const size of sizes) {
        try {
          await app.vault.adapter.rmdir(`bulk-${String(size)}`, true);
        } catch {
          // Ignore — the bulk folder may not exist.
        }
        try {
          await app.vault.adapter.remove(`control-${String(size)}.md`);
        } catch {
          // Ignore — the control file may not exist.
        }
      }
    },
    vaultPath: getTempVault().path
  });
});

describe('Vault size scaling — Full mode', () => {
  for (const size of SCENARIO_SIZES) {
    it(`hides and re-shows a ${String(size)}-file folder with a single deletion`, async () => {
      const result = await runScenario(size);

      expect(result.error).toBeNull();
      /*
       * The whole folder collapses to one hide-root regardless of size — the
       * property that turns the old O(subtree) freeze into O(1).
       */
      expect(result.reconcileDeletionCount).toBe(EXPECTED_HIDE_ROOT_RECONCILE_DELETIONS);
      // Every file under the ignored folder is gone from the vault.
      expect(result.bulkVisibleAfterHide).toBe(0);
      // A sibling file outside the pattern stays visible.
      expect(result.isControlVisibleAfterHide).toBe(true);
      // Removing the pattern in the same session brings the whole folder back.
      expect(result.bulkVisibleAfterShow).toBe(size);
    }, SCENARIO_TIMEOUT_IN_MS);
  }
});

function runScenario(size: number): Promise<VaultSizeScenarioResult> {
  return evalInObsidian({
    args: {
      CREATE_BATCH_SIZE,
      OBSIDIAN_IGNORE_FILE,
      PLUGIN_ID,
      settle,
      SETTLE_DELAY_IN_MS,
      size
    },
    async fn({
      app,
      CREATE_BATCH_SIZE: batchSize,
      OBSIDIAN_IGNORE_FILE: ignoreFile,
      PLUGIN_ID: pluginId,
      settle: settleWait,
      SETTLE_DELAY_IN_MS: settleDelay,
      size: fileCount
    }) {
      const folder = `bulk-${String(fileCount)}`;
      const controlPath = `control-${String(fileCount)}.md`;
      const pattern = `${folder}/\n`;

      /*
       * Build a clean baseline while the plugin is off: no patterns on disk and a
       * freshly generated folder of `fileCount` files plus one sibling control
       * file. Creating via the core vault API indexes the files so the next
       * enable rebuilds the plugin model from a fully loaded tree.
       */
      await app.plugins.disablePluginAndSave(pluginId);
      await removeQuietly(ignoreFile);
      await rmdirQuietly(folder);
      await removeQuietly(controlPath);

      await app.vault.createFolder(folder);
      await app.vault.create(controlPath, 'control');
      for (let start = 0; start < fileCount; start += batchSize) {
        const batch: Promise<unknown>[] = [];
        for (let index = start; index < Math.min(start + batchSize, fileCount); index++) {
          batch.push(app.vault.create(`${folder}/file-${String(index)}.md`, ''));
        }
        await Promise.all(batch);
      }

      await app.plugins.enablePluginAndSave(pluginId);
      await settleWait(settleDelay);

      const plugin = app.plugins.getPlugin(pluginId);
      if (!plugin) {
        return makeResult('Plugin not loaded');
      }

      const ignorePatternsComponent = findComponent(plugin, 'IgnorePatternsComponent') as IgnorePatternsComponent | undefined;
      const pluginSettingsComponent = findComponent(plugin, 'PluginSettingsComponent') as PluginSettingsComponent | undefined;
      if (!ignorePatternsComponent || !pluginSettingsComponent) {
        return makeResult('Could not locate plugin components');
      }

      /*
       * Count only deletions inside the ignored folder. Saving settings also
       * churns config files (`data.json`, `.obsidianignore`) which fire their own
       * reconciles; those are constant noise unrelated to vault size. The folder
       * subtree must collapse to a single deletion (its hide-root) at any N.
       */
      const adapterEx = app.vault.adapter as DataAdapterEx;
      const originalReconcileDeletion = adapterEx.reconcileDeletion.bind(adapterEx);
      let reconcileDeletionCount = 0;
      adapterEx.reconcileDeletion = async (normalizedPath, normalizedNewPath, shouldSkipDeletionTimeout): Promise<void> => {
        if (normalizedPath === folder || normalizedPath.startsWith(`${folder}/`)) {
          reconcileDeletionCount++;
        }
        await originalReconcileDeletion(normalizedPath, normalizedNewPath, shouldSkipDeletionTimeout);
      };

      try {
        /*
         * Reproduce the exact "edit settings to change ignores" flow: saving the
         * setting fires `saveSettings` (reloads patterns, marks a pending change)
         * and closing the tab runs `processConfigChanges`, which drives the
         * incremental projection delta — the path that used to freeze.
         */
        await pluginSettingsComponent.editAndSave((settings) => {
          settings.obsidianIgnoreContent = pattern;
        });
        await ignorePatternsComponent.processConfigChanges();
        await settleWait(settleDelay);

        const visibleAfterHide = app.vault.getFiles().map((file) => file.path);
        const bulkVisibleAfterHide = visibleAfterHide.filter((path) => path.startsWith(`${folder}/`)).length;
        const isControlVisibleAfterHide = visibleAfterHide.includes(controlPath);

        // Remove the pattern the same way and confirm the folder returns live with no reload — the model must have retained the hidden subtree.
        await pluginSettingsComponent.editAndSave((settings) => {
          settings.obsidianIgnoreContent = '';
        });
        await ignorePatternsComponent.processConfigChanges();
        await settleWait(settleDelay);

        const bulkVisibleAfterShow = app.vault.getFiles().map((file) => file.path).filter((path) => path.startsWith(`${folder}/`)).length;

        return {
          bulkVisibleAfterHide,
          bulkVisibleAfterShow,
          error: null,
          isControlVisibleAfterHide,
          reconcileDeletionCount
        };
      } finally {
        adapterEx.reconcileDeletion = originalReconcileDeletion;
      }

      function makeResult(error: string): VaultSizeScenarioResult {
        return {
          bulkVisibleAfterHide: -1,
          bulkVisibleAfterShow: -1,
          error,
          isControlVisibleAfterHide: false,
          reconcileDeletionCount: -1
        };
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

      async function removeQuietly(path: string): Promise<void> {
        try {
          await app.vault.adapter.remove(path);
        } catch {
          // Ignore — the path may not exist.
        }
      }

      async function rmdirQuietly(path: string): Promise<void> {
        try {
          await app.vault.adapter.rmdir(path, true);
        } catch {
          // Ignore — the folder may not exist.
        }
      }
    },
    vaultPath: getTempVault().path
  });
}
