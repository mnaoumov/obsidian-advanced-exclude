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

interface ScenarioSpec {
  // Sibling file outside the ignored scope; must stay visible after the hide.
  readonly controlPath: string;
  // Number of `reconcileDeletion` calls expected within the scope (= hide-roots).
  readonly expectedDeletionCount: number;
  // Total files inside the scope; all must vanish on hide and return on un-ignore.
  readonly fileCount: number;
  readonly files: readonly string[];
  // Folders to create, ordered shallowest-first so parents exist before children.
  readonly folders: readonly string[];
  readonly pattern: string;
  // Path prefix identifying the ignored scope, for counting deletions and files.
  readonly scopePrefix: string;
}

interface TraversableComponent {
  readonly _children?: readonly unknown[];
}

interface VaultSizeScenarioResult {
  readonly error: null | string;
  readonly inScopeVisibleAfterHide: number;
  readonly inScopeVisibleAfterShow: number;
  readonly isControlVisibleAfterHide: boolean;
  readonly reconcileDeletionCount: number;
}

const PLUGIN_ID = 'advanced-exclude';
const OBSIDIAN_IGNORE_FILE = '.obsidianignore';

// Flat-folder sizes: prove the hide cost is independent of file count.
const FLAT_SIZES = [100, 1000, 3000];

// Deep + wide tree under one ignored root: hundreds of nested folders, one hide-root.
const NESTED_ROOT = 'tree';
const NESTED_BREADTH = 4;
const NESTED_DEPTH = 4;
const NESTED_FILES_PER_FOLDER = 2;

// Many sibling folders, each ignored independently: one hide-root per folder.
const MANY_PARENT = 'many';
const MANY_FOLDER_COUNT = 200;
const MANY_FILES_PER_FOLDER = 4;

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
 * Per-test timeout: building a vault of thousands of files and folders plus a
 * reload needs well beyond the default 30 s desktop budget.
 */
const SCENARIO_TIMEOUT_IN_MS = 240_000;

function settle(settleDelay: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, settleDelay);
  });
}

afterEach(async () => {
  const topFolders = [...FLAT_SIZES.map((size) => `bulk-${String(size)}`), NESTED_ROOT, MANY_PARENT];
  const controlFiles = [...FLAT_SIZES.map((size) => `control-${String(size)}.md`), 'control-nested.md', 'control-many.md'];
  await evalInObsidian({
    args: {
      controlFiles,
      OBSIDIAN_IGNORE_FILE,
      topFolders
    },
    async fn({ app, controlFiles: controls, OBSIDIAN_IGNORE_FILE: ignoreFile, topFolders: folders }) {
      try {
        await app.vault.adapter.remove(ignoreFile);
      } catch {
        // Ignore — the ignore file may not exist.
      }
      for (const folder of folders) {
        try {
          await app.vault.adapter.rmdir(folder, true);
        } catch {
          // Ignore — the folder may not exist.
        }
      }
      for (const control of controls) {
        try {
          await app.vault.adapter.remove(control);
        } catch {
          // Ignore — the control file may not exist.
        }
      }
    },
    vaultPath: getTempVault().path
  });
});

describe('Vault size scaling — Full mode', () => {
  for (const size of FLAT_SIZES) {
    it(`hides and re-shows a flat ${String(size)}-file folder with a single deletion`, async () => {
      await assertScenario(flatSpec(size));
    }, SCENARIO_TIMEOUT_IN_MS);
  }

  it('hides and re-shows a deep, wide folder tree with a single deletion', async () => {
    await assertScenario(nestedTreeSpec());
  }, SCENARIO_TIMEOUT_IN_MS);

  it('hides and re-shows many independently-ignored folders, one deletion each', async () => {
    await assertScenario(manyFoldersSpec());
  }, SCENARIO_TIMEOUT_IN_MS);
});

async function assertScenario(spec: ScenarioSpec): Promise<void> {
  const result = await runIgnoreScenario(spec);

  expect(result.error).toBeNull();
  // Hiding issues exactly one deletion per hide-root, independent of file count.
  expect(result.reconcileDeletionCount).toBe(spec.expectedDeletionCount);
  // Every file inside the ignored scope is gone from the vault.
  expect(result.inScopeVisibleAfterHide).toBe(0);
  // A sibling outside the pattern stays visible.
  expect(result.isControlVisibleAfterHide).toBe(true);
  // Removing the pattern in the same session brings the whole scope back.
  expect(result.inScopeVisibleAfterShow).toBe(spec.fileCount);
}

function flatSpec(fileCount: number): ScenarioSpec {
  const folder = `bulk-${String(fileCount)}`;
  const files = Array.from({ length: fileCount }, (_unused, index) => `${folder}/file-${String(index)}.md`);
  return {
    controlPath: `control-${String(fileCount)}.md`,
    expectedDeletionCount: 1,
    fileCount,
    files,
    folders: [folder],
    pattern: `${folder}/\n`,
    scopePrefix: folder
  };
}

function manyFoldersSpec(): ScenarioSpec {
  const folders: string[] = [MANY_PARENT];
  const files: string[] = [];
  for (let moduleIndex = 0; moduleIndex < MANY_FOLDER_COUNT; moduleIndex++) {
    const moduleFolder = `${MANY_PARENT}/module-${String(moduleIndex)}`;
    const subFolder = `${moduleFolder}/sub`;
    folders.push(moduleFolder, subFolder);
    for (let fileIndex = 0; fileIndex < MANY_FILES_PER_FOLDER; fileIndex++) {
      files.push(`${moduleFolder}/file-${String(fileIndex)}.md`);
    }
    files.push(`${subFolder}/nested.md`);
  }
  return {
    controlPath: 'control-many.md',
    // The parent stays visible; each `module-*` folder is its own hide-root.
    expectedDeletionCount: MANY_FOLDER_COUNT,
    fileCount: files.length,
    files,
    folders,
    pattern: `${MANY_PARENT}/module-*/\n`,
    scopePrefix: `${MANY_PARENT}/module-`
  };
}

function nestedTreeSpec(): ScenarioSpec {
  const folders: string[] = [];
  const files: string[] = [];
  addNestedFolder(NESTED_ROOT);
  let currentLevel = [NESTED_ROOT];
  for (let depth = 1; depth <= NESTED_DEPTH; depth++) {
    const nextLevel: string[] = [];
    for (const parent of currentLevel) {
      for (let branch = 0; branch < NESTED_BREADTH; branch++) {
        const child = `${parent}/dir-${String(branch)}`;
        addNestedFolder(child);
        nextLevel.push(child);
      }
    }
    currentLevel = nextLevel;
  }
  return {
    controlPath: 'control-nested.md',
    expectedDeletionCount: 1,
    fileCount: files.length,
    files,
    folders,
    pattern: `${NESTED_ROOT}/\n`,
    scopePrefix: NESTED_ROOT
  };

  function addNestedFolder(path: string): void {
    folders.push(path);
    for (let fileIndex = 0; fileIndex < NESTED_FILES_PER_FOLDER; fileIndex++) {
      files.push(`${path}/file-${String(fileIndex)}.md`);
    }
  }
}

function runIgnoreScenario(spec: ScenarioSpec): Promise<VaultSizeScenarioResult> {
  return evalInObsidian({
    args: {
      CREATE_BATCH_SIZE,
      OBSIDIAN_IGNORE_FILE,
      PLUGIN_ID,
      settle,
      SETTLE_DELAY_IN_MS,
      spec
    },
    async fn({
      app,
      CREATE_BATCH_SIZE: batchSize,
      OBSIDIAN_IGNORE_FILE: ignoreFile,
      PLUGIN_ID: pluginId,
      settle: settleWait,
      SETTLE_DELAY_IN_MS: settleDelay,
      spec: scenario
    }) {
      const { controlPath, files, folders, pattern, scopePrefix } = scenario;
      const topFolders = folders.filter((folder) => !folder.includes('/'));

      /*
       * Build a clean baseline while the plugin is off: no patterns on disk and a
       * freshly generated folder structure plus one sibling control file. Creating
       * via the core vault API indexes everything so the next enable rebuilds the
       * plugin model from a fully loaded tree.
       */
      await app.plugins.disablePluginAndSave(pluginId);
      await removeQuietly(ignoreFile);
      for (const folder of topFolders) {
        await rmdirQuietly(folder);
      }
      await removeQuietly(controlPath);

      for (const folder of folders) {
        await app.vault.createFolder(folder);
      }
      await app.vault.create(controlPath, 'control');
      for (let start = 0; start < files.length; start += batchSize) {
        const batch = files.slice(start, start + batchSize).map((path) => app.vault.create(path, ''));
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
       * Count only deletions inside the ignored scope. Saving settings also churns
       * config files (`data.json`, `.obsidianignore`) which fire their own
       * reconciles; those are constant noise unrelated to vault size. Each ignored
       * folder must collapse to a single deletion (its hide-root), at any size.
       */
      const adapterEx = app.vault.adapter as DataAdapterEx;
      const originalReconcileDeletion = adapterEx.reconcileDeletion.bind(adapterEx);
      let reconcileDeletionCount = 0;
      adapterEx.reconcileDeletion = async (normalizedPath, normalizedNewPath, shouldSkipDeletionTimeout): Promise<void> => {
        if (normalizedPath.startsWith(scopePrefix)) {
          reconcileDeletionCount++;
        }
        await originalReconcileDeletion(normalizedPath, normalizedNewPath, shouldSkipDeletionTimeout);
      };

      try {
        /*
         * Reproduce the exact "edit settings to change ignores" flow: saving the
         * setting fires `saveSettings` (reloads patterns, marks a pending change)
         * and `processConfigChanges` drives the incremental projection delta — the
         * path that used to freeze.
         */
        await pluginSettingsComponent.editAndSave((settings) => {
          settings.obsidianIgnoreContent = pattern;
        });
        await ignorePatternsComponent.processConfigChanges();
        await settleWait(settleDelay);

        const visibleAfterHide = app.vault.getFiles().map((file) => file.path);
        const inScopeVisibleAfterHide = visibleAfterHide.filter((path) => path.startsWith(scopePrefix)).length;
        const isControlVisibleAfterHide = visibleAfterHide.includes(controlPath);

        // Remove the pattern the same way and confirm the scope returns live with no reload — the model must have retained the hidden subtree.
        await pluginSettingsComponent.editAndSave((settings) => {
          settings.obsidianIgnoreContent = '';
        });
        await ignorePatternsComponent.processConfigChanges();
        await settleWait(settleDelay);

        const inScopeVisibleAfterShow = app.vault.getFiles().map((file) => file.path).filter((path) => path.startsWith(scopePrefix)).length;

        return {
          error: null,
          inScopeVisibleAfterHide,
          inScopeVisibleAfterShow,
          isControlVisibleAfterHide,
          reconcileDeletionCount
        };
      } finally {
        adapterEx.reconcileDeletion = originalReconcileDeletion;
      }

      function makeResult(error: string): VaultSizeScenarioResult {
        return {
          error,
          inScopeVisibleAfterHide: -1,
          inScopeVisibleAfterShow: -1,
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
