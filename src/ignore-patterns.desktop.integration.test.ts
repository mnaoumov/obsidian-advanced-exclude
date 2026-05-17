import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

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
  'keep-this.md',
  'normal-file.md',
  'secret-folder/nested.md',
  'secret-note.md',
  'visible-note.md'
];

const ALL_TEST_FOLDERS = [
  'secret-folder'
];

function settle(settleDelay: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, settleDelay);
  });
}

afterEach(async () => {
  await evalInObsidian({
    args: {
      ALL_TEST_FILES,
      ALL_TEST_FOLDERS
    },
    async fn({ ALL_TEST_FILES: files, ALL_TEST_FOLDERS: folders, app }) {
      for (const path of files) {
        try {
          const file = app.vault.getAbstractFileByPath(path);
          if (file) {
            // eslint-disable-next-line obsidianmd/prefer-file-manager-trash-file -- Test cleanup.
            await app.vault.delete(file, true);
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
    vaultPath: getTempVault().path
  });
});

describe('Ignore patterns — Full mode (vault-level exclusion)', () => {
  it('should exclude files matching .obsidianignore patterns from the vault', async () => {
    const result = await evalInObsidian({
      args: {
        PLUGIN_ID,
        settle,
        SETTLE_DELAY_IN_MS
      },
      async fn({ app, PLUGIN_ID: pluginId, settle: settleWait, SETTLE_DELAY_IN_MS: settleDelay }) {
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
        await settleWait(settleDelay);

        // Now create files that match the ignore pattern — use adapter to bypass plugin filtering
        await app.vault.adapter.write('secret-note.md', 'I should be hidden');
        await app.vault.adapter.mkdir('secret-folder');
        await app.vault.adapter.write('secret-folder/nested.md', 'Also hidden');

        // Reload plugin again to process the new files with ignore patterns active
        await app.plugins.disablePluginAndSave(pluginId);
        await app.plugins.enablePluginAndSave(pluginId);
        await settleWait(settleDelay);

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
      vaultPath: getTempVault().path
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

  it('should include .gitignore patterns when shouldIncludeGitIgnorePatterns is enabled', async () => {
    const result = await evalInObsidian({
      args: {
        PLUGIN_ID,
        settle,
        SETTLE_DELAY_IN_MS
      },
      async fn({ app, PLUGIN_ID: pluginId, settle: settleWait, SETTLE_DELAY_IN_MS: settleDelay }) {
        const plugin = app.plugins.getPlugin(pluginId);
        if (!plugin) {
          return { error: 'Plugin not loaded' };
        }

        // Write .gitignore and ignored file to disk
        await app.vault.adapter.write('.gitignore', '*.log\n');
        await app.vault.adapter.write('build-output.log', 'I should be hidden by gitignore');

        // Create visible file via vault API
        await app.vault.create('normal-file.md', 'I am normal');

        // Reload plugin to pick up .gitignore patterns
        await app.plugins.disablePluginAndSave(pluginId);
        await app.plugins.enablePluginAndSave(pluginId);
        await settleWait(settleDelay);

        const allFiles = app.vault.getFiles().map((f) => f.path).sort();

        return {
          allFiles,
          error: null
        };
      },
      vaultPath: getTempVault().path
    });

    expect(result.error).toBeNull();
    expect(result.allFiles).not.toContain('build-output.log');
    expect(result.allFiles).toContain('normal-file.md');
  });
});

describe('Ignore patterns — File explorer exclusion', () => {
  it('should hide ignored files from the file explorer in Full mode', async () => {
    const result = await evalInObsidian({
      args: {
        PLUGIN_ID,
        settle,
        SETTLE_DELAY_IN_MS
      },
      async fn({ app, PLUGIN_ID: pluginId, settle: settleWait, SETTLE_DELAY_IN_MS: settleDelay }) {
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
        await settleWait(settleDelay);

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
      vaultPath: getTempVault().path
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
      args: {
        PLUGIN_ID,
        settle,
        SETTLE_DELAY_IN_MS
      },
      async fn({ app, PLUGIN_ID: pluginId, settle: settleWait, SETTLE_DELAY_IN_MS: settleDelay }) {
        const plugin = app.plugins.getPlugin(pluginId);
        if (!plugin) {
          return { error: 'Plugin not loaded' };
        }

        // Create test files — all should start as visible
        await app.vault.create('alpha.md', 'alpha');
        await app.vault.create('beta.md', 'beta');
        await app.vault.create('gamma.md', 'gamma');
        await settleWait(settleDelay);

        const filesBefore = app.vault.getFiles().map((f) => f.path).sort();

        // Write .obsidianignore that excludes beta* and reload
        await app.vault.adapter.write('.obsidianignore', 'beta*\n');
        await app.plugins.disablePluginAndSave(pluginId);
        await app.plugins.enablePluginAndSave(pluginId);
        await settleWait(settleDelay);

        const filesAfterExclude = app.vault.getFiles().map((f) => f.path).sort();

        // Update the ignore file to exclude gamma* instead
        await app.vault.adapter.write('.obsidianignore', 'gamma*\n');
        await app.plugins.disablePluginAndSave(pluginId);
        await app.plugins.enablePluginAndSave(pluginId);
        await settleWait(settleDelay);

        const filesAfterChange = app.vault.getFiles().map((f) => f.path).sort();

        return {
          error: null,
          filesAfterChange,
          filesAfterExclude,
          filesBefore
        };
      },
      vaultPath: getTempVault().path
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
