import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

interface TraversableComponent {
  readonly _children?: readonly unknown[];
}

const PLUGIN_ID = 'advanced-exclude';
const SETTLE_DELAY_IN_MS = 5000;

const ALL_TEST_FILES = [
  '.gitignore',
  '.obsidianignore',
  'alpha.md',
  'beta.md',
  'build-output.log',
  'explorer-hidden.md',
  'explorer-visible.md',
  'gamma.md',
  'gitignored-note.md',
  'keep-this.md',
  'normal-file.md',
  'secret-folder/nested.md',
  'secret-note.md',
  'visible-note.md'
];

const ALL_TEST_FOLDERS = [
  'secret-folder'
];

afterEach(async () => {
  await evalInObsidian({
    async callback({ ALL_TEST_FILES: files, ALL_TEST_FOLDERS: folders, app }) {
      for (const path of files) {
        try {
          const file = app.vault.getAbstractFileByPath(path);
          if (file) {
            await app.fileManager.trashFile(file);
          }
        } catch {
          // Ignore
        }
        try {
          await app.vault.adapter.remove(path);
        } catch {
          // Ignore
        }
      }
      for (const folder of folders) {
        try {
          await app.vault.adapter.rmdir(folder, true);
        } catch {
          // Ignore
        }
      }
    },
    input: {
      ALL_TEST_FILES,
      ALL_TEST_FOLDERS
    },
    vaultPath: getTemporaryVault().path
  });
});

describe('Ignore patterns — Full mode (vault-level exclusion)', () => {
  it('should exclude files matching .obsidianignore patterns from the vault', async () => {
    const result = await evalInObsidian({
      async callback({ app, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay }) {
        const plugin = app.plugins.getPlugin(pluginId);
        if (!plugin) {
          return { error: 'Plugin not loaded' };
        }

        // Create visible files via vault API
        await app.vault.create('visible-note.md', 'I should be visible');
        await app.vault.create('keep-this.md', 'I should stay visible');

        // Write .obsidianignore to disk and reload plugin to pick up patterns
        await app.vault.adapter.write('.obsidianignore', 'secret-*\n');
        await app.plugins.disablePluginAndSave(pluginId);
        await app.plugins.enablePluginAndSave(pluginId);
        await sleep(settleDelay);

        // Now create files that match the ignore pattern — use adapter to bypass plugin filtering
        await app.vault.adapter.write('secret-note.md', 'I should be hidden');
        await app.vault.adapter.mkdir('secret-folder');
        await app.vault.adapter.write('secret-folder/nested.md', 'Also hidden');

        // Reload plugin again to process the new files with ignore patterns active
        await app.plugins.disablePluginAndSave(pluginId);
        await app.plugins.enablePluginAndSave(pluginId);
        await sleep(settleDelay);

        // Check which files are visible in the vault
        const allFiles = app.vault.getFiles().map((f) => f.path).sort();
        const allLoadedFiles = app.vault.getAllLoadedFiles()
          .filter((f) => 'extension' in f)
          .map((f) => f.path)
          .sort();

        return {
          allFiles,
          allLoadedFiles,
          error: null
        };
      },
      input: {
        PLUGIN_ID,
        SETTLE_DELAY_IN_MS
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();
    // Secret files should NOT appear in vault file listing
    expect(result.allFiles).not.toContain('secret-note.md');
    expect(result.allFiles).not.toContain('secret-folder/nested.md');
    // Visible files should still be present
    expect(result.allFiles).toContain('visible-note.md');
    expect(result.allFiles).toContain('keep-this.md');

    // Same for getAllLoadedFiles
    expect(result.allLoadedFiles).not.toContain('secret-note.md');
    expect(result.allLoadedFiles).not.toContain('secret-folder/nested.md');
  });

  it('should not include .gitignore patterns by default', async () => {
    const result = await evalInObsidian({
      async callback({ app, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay }) {
        const plugin = app.plugins.getPlugin(pluginId);
        if (!plugin) {
          return { error: 'Plugin not loaded' };
        }

        // Write .gitignore and the note it ignores to disk, leaving the setting at its default.
        await app.vault.adapter.write('.gitignore', 'gitignored-note.md\n');
        await app.vault.adapter.write('gitignored-note.md', 'I am ignored by git, not by Obsidian');

        // Create visible file via vault API
        await app.vault.create('normal-file.md', 'I am normal');

        // Reload plugin so it would pick up .gitignore patterns if the setting allowed it
        await app.plugins.disablePluginAndSave(pluginId);
        await app.plugins.enablePluginAndSave(pluginId);
        await sleep(settleDelay);

        const allFiles = app.vault.getFiles().map((f) => f.path).sort();

        return {
          allFiles,
          error: null
        };
      },
      input: {
        PLUGIN_ID,
        SETTLE_DELAY_IN_MS
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();
    // The vault's .gitignore is not the plugin's business until the user says so.
    expect(result.allFiles).toContain('gitignored-note.md');
    expect(result.allFiles).toContain('normal-file.md');
  });

  it('should include .gitignore patterns when shouldIncludeGitIgnorePatterns is enabled', async () => {
    const result = await evalInObsidian({
      async callback({ app, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay }) {
        const plugin = app.plugins.getPlugin(pluginId);
        if (!plugin) {
          return { error: 'Plugin not loaded' };
        }

        const pluginSettingsComponent = findComponent(plugin, 'PluginSettingsComponent') as PluginSettingsComponent | undefined;
        if (!pluginSettingsComponent) {
          return { error: 'Could not locate PluginSettingsComponent' };
        }

        // The setting is off by default, so this source has to be turned on explicitly.
        await pluginSettingsComponent.editAndSave((settings) => {
          settings.shouldIncludeGitIgnorePatterns = true;
        });

        // Write .gitignore and ignored files to disk
        await app.vault.adapter.write('.gitignore', '*.log\ngitignored-note.md\n');
        await app.vault.adapter.write('build-output.log', 'I should be hidden by gitignore');
        await app.vault.adapter.write('gitignored-note.md', 'I should be hidden by gitignore');

        // Create visible file via vault API
        await app.vault.create('normal-file.md', 'I am normal');

        // Reload plugin to pick up .gitignore patterns
        await app.plugins.disablePluginAndSave(pluginId);
        await app.plugins.enablePluginAndSave(pluginId);
        await sleep(settleDelay);

        const allFiles = app.vault.getFiles().map((f) => f.path).sort();

        /*
         * `editAndSave` persists to `data.json`, which outlives this test — reset the setting on the
         * reloaded plugin so the rest of the suite still sees the shipped default.
         */
        const reloadedPlugin = app.plugins.getPlugin(pluginId);
        const reloadedSettingsComponent = reloadedPlugin
          ? findComponent(reloadedPlugin, 'PluginSettingsComponent') as PluginSettingsComponent | undefined
          : undefined;
        await reloadedSettingsComponent?.editAndSave((settings) => {
          settings.shouldIncludeGitIgnorePatterns = false;
        });

        return {
          allFiles,
          error: null
        };

        function findComponent(root: object, className: string): unknown {
          if (root.constructor.name === className) {
            return root;
          }

          for (const child of ((root as TraversableComponent)._children ?? [])) {
            if (typeof child !== 'object' || !child) {
              continue;
            }

            const found = findComponent(child, className);
            if (found) {
              return found;
            }
          }

          return undefined;
        }
      },
      input: {
        PLUGIN_ID,
        SETTLE_DELAY_IN_MS
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();
    expect(result.allFiles).not.toContain('gitignored-note.md');
    expect(result.allFiles).not.toContain('build-output.log');
    expect(result.allFiles).toContain('normal-file.md');
  });
});

describe('Ignore patterns — File explorer exclusion', () => {
  it('should hide ignored files from the file explorer in Full mode', async () => {
    const result = await evalInObsidian({
      async callback({ app, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay }) {
        const plugin = app.plugins.getPlugin(pluginId);
        if (!plugin) {
          return { error: 'Plugin not loaded' };
        }

        // Create visible file
        await app.vault.create('explorer-visible.md', 'Visible in explorer');

        // Write ignore pattern and hidden file
        await app.vault.adapter.write('.obsidianignore', 'explorer-hidden*\n');
        await app.vault.adapter.write('explorer-hidden.md', 'Hidden in explorer');

        // Reload plugin to apply patterns
        await app.plugins.disablePluginAndSave(pluginId);
        await app.plugins.enablePluginAndSave(pluginId);
        await sleep(settleDelay);

        // Check the file explorer
        const fileExplorerLeaf = app.workspace.getLeavesOfType('file-explorer')[0];
        const fileExplorerView = fileExplorerLeaf?.view as FileExplorerView | undefined;
        const fileItems = fileExplorerView?.fileItems ? Object.keys(fileExplorerView.fileItems) : [];

        return {
          error: null,
          fileItems,
          hasFileExplorer: !!fileExplorerView
        };
      },
      input: {
        PLUGIN_ID,
        SETTLE_DELAY_IN_MS
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();
    expect(result.hasFileExplorer).toBe(true);
    expect(result.fileItems).not.toContain('explorer-hidden.md');
    expect(result.fileItems).toContain('explorer-visible.md');
  });
});

describe('Ignore patterns — Settings round-trip', () => {
  it('should apply new ignore patterns when settings are changed', async () => {
    const result = await evalInObsidian({
      async callback({ app, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay }) {
        const plugin = app.plugins.getPlugin(pluginId);
        if (!plugin) {
          return { error: 'Plugin not loaded' };
        }

        // Create test files — all should start as visible
        await app.vault.create('alpha.md', 'alpha');
        await app.vault.create('beta.md', 'beta');
        await app.vault.create('gamma.md', 'gamma');
        await sleep(settleDelay);

        const filesBefore = app.vault.getFiles().map((f) => f.path).sort();

        // Write .obsidianignore that excludes beta* and reload
        await app.vault.adapter.write('.obsidianignore', 'beta*\n');
        await app.plugins.disablePluginAndSave(pluginId);
        await app.plugins.enablePluginAndSave(pluginId);
        await sleep(settleDelay);

        const filesAfterExclude = app.vault.getFiles().map((f) => f.path).sort();

        // Update the ignore file to exclude gamma* instead
        await app.vault.adapter.write('.obsidianignore', 'gamma*\n');
        await app.plugins.disablePluginAndSave(pluginId);
        await app.plugins.enablePluginAndSave(pluginId);
        await sleep(settleDelay);

        const filesAfterChange = app.vault.getFiles().map((f) => f.path).sort();

        return {
          error: null,
          filesAfterChange,
          filesAfterExclude,
          filesBefore
        };
      },
      input: {
        PLUGIN_ID,
        SETTLE_DELAY_IN_MS
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();

    // Before any exclusion, all files should be visible
    expect(result.filesBefore).toContain('alpha.md');
    expect(result.filesBefore).toContain('beta.md');
    expect(result.filesBefore).toContain('gamma.md');

    // After excluding beta*, beta should be gone
    expect(result.filesAfterExclude).toContain('alpha.md');
    expect(result.filesAfterExclude).not.toContain('beta.md');
    expect(result.filesAfterExclude).toContain('gamma.md');

    // After changing pattern to gamma*, beta should reappear and gamma should be gone
    expect(result.filesAfterChange).toContain('alpha.md');
    expect(result.filesAfterChange).toContain('beta.md');
    expect(result.filesAfterChange).not.toContain('gamma.md');
  });
});
