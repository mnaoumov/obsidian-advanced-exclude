import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';
import type {
  FileSystemAdapter,
  Plugin
} from 'obsidian';

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
const ACTIVE_PROFILE_LOCAL_STORAGE_KEY = 'advanced-exclude:active-profile';
const IMPORTED_FILE = '.profile-ignore';

interface FilesSnapshot {
  explorer: string[];
  loaded: string[];
}

interface ProfilesTestPlugin extends Plugin {
  pluginSettingsComponent: PluginSettingsComponent;
}

const TEST_FILES = [
  'work/a.md',
  'work/keep.md',
  'home/b.md'
];

const TEST_FOLDERS = [
  'home',
  'work'
];

afterEach(async () => {
  await evalInObsidian({
    async callback({ app, IMPORTED_FILE: importedFile, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay, TEST_FILES: files, TEST_FOLDERS: folders }) {
      const plugin = app.plugins.getPlugin(pluginId) as null | ProfilesTestPlugin;
      if (plugin) {
        await plugin.pluginSettingsComponent.setActiveProfileId(null);
        await plugin.pluginSettingsComponent.editAndSave((settings) => {
          settings.profiles = [];
        });
        await sleep(settleDelay);
      }
      for (const path of [...files, importedFile]) {
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
    input: { IMPORTED_FILE, PLUGIN_ID, SETTLE_DELAY_IN_MS, TEST_FILES, TEST_FOLDERS },
    vaultPath: getTemporaryVault().path
  });
});

describe('Profiles', () => {
  it('switches the hidden set with the active profile, composed by @import, and keeps the choice on this device', async () => {
    const result = await evalInObsidian({
      async callback({ ACTIVE_PROFILE_LOCAL_STORAGE_KEY: localStorageKey, app, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay, TEST_FILES: files }) {
        const plugin = app.plugins.getPlugin(pluginId) as null | ProfilesTestPlugin;
        if (!plugin) {
          return { error: 'Plugin not loaded' };
        }
        const settingsComponent = plugin.pluginSettingsComponent;

        function snapshot(): FilesSnapshot {
          const view = app.workspace.getLeavesOfType('file-explorer')[0]?.view as FileExplorerView | undefined;
          return {
            explorer: files.filter((path) => view?.fileItems[path] !== undefined),
            loaded: files.filter((path) => app.vault.getAbstractFileByPath(path) !== null)
          };
        }

        async function activate(profileId: null | string): Promise<FilesSnapshot> {
          await settingsComponent.setActiveProfileId(profileId);
          await sleep(settleDelay);
          return snapshot();
        }

        await app.vault.adapter.write('.obsidianignore', '');
        await app.vault.adapter.mkdir('work');
        await app.vault.adapter.mkdir('home');
        for (const path of files) {
          await app.vault.adapter.write(path, path);
        }
        await sleep(settleDelay);

        await settingsComponent.editAndSave((settings) => {
          settings.profiles = [
            { id: 'work-id', name: 'Work', patterns: 'work/*' },
            { id: 'both-id', name: 'Both', patterns: '@import Work\nhome/\n!work/keep.md' }
          ];
        });

        const base = snapshot();
        const work = await activate('work-id');
        const both = await activate('both-id');
        const storedActiveProfileId: unknown = app.loadLocalStorage(localStorageKey);
        const dataJson = await app.vault.adapter.read(`${plugin.manifest.dir ?? ''}/data.json`);
        const backToBase = await activate(null);

        return { backToBase, base, both, dataJson, error: null, storedActiveProfileId, work };
      },
      input: { ACTIVE_PROFILE_LOCAL_STORAGE_KEY, PLUGIN_ID, SETTLE_DELAY_IN_MS, TEST_FILES },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();
    expect(result.base?.loaded).toStrictEqual(TEST_FILES);

    expect(result.work?.loaded).toStrictEqual(['home/b.md']);
    expect(result.work?.explorer).toStrictEqual(['home/b.md']);

    // `Both` imports `Work`, hides `home/`, and its later negation re-includes a file `Work` hid.
    expect(result.both?.loaded).toStrictEqual(['work/keep.md']);
    expect(result.both?.explorer).toStrictEqual(['work/keep.md']);

    // The choice is per device: it lives in local storage, never in the synced `data.json`.
    expect(result.storedActiveProfileId).toBe('both-id');
    expect(result.dataJson).toContain('"profiles"');
    expect(result.dataJson).not.toContain('activeProfile');

    expect(result.backToBase?.loaded).toStrictEqual(TEST_FILES);
  });

  it('expands an @import file: line and re-applies when the imported file changes on disk', async () => {
    const result = await evalInObsidian({
      async callback({ app, IMPORTED_FILE: importedFile, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay, TEST_FILES: files }) {
        const plugin = app.plugins.getPlugin(pluginId) as null | ProfilesTestPlugin;
        if (!plugin) {
          return { error: 'Plugin not loaded' };
        }
        const settingsComponent = plugin.pluginSettingsComponent;
        const adapter = app.vault.adapter as FileSystemAdapter;

        function loaded(): string[] {
          return files.filter((path) => app.vault.getAbstractFileByPath(path) !== null);
        }

        await app.vault.adapter.write('.obsidianignore', '');
        await app.vault.adapter.mkdir('work');
        await app.vault.adapter.mkdir('home');
        for (const path of files) {
          await app.vault.adapter.write(path, path);
        }
        await app.vault.adapter.write(importedFile, 'work/*');
        await sleep(settleDelay);

        await settingsComponent.editAndSave((settings) => {
          settings.profiles = [{ id: 'file-id', name: 'From file', patterns: `@import file:${importedFile}\n!work/keep.md` }];
        });
        await settingsComponent.setActiveProfileId('file-id');
        await sleep(settleDelay);
        const imported = loaded();

        // Written behind Obsidian's back, as another editor would: only the file watcher sees it.
        await adapter.fsPromises.writeFile(adapter.getFullPath(importedFile), 'home/');
        await sleep(settleDelay);
        const edited = loaded();

        await app.vault.adapter.remove(importedFile);
        await sleep(settleDelay);
        const removed = loaded();

        return { edited, error: null, imported, removed };
      },
      input: { IMPORTED_FILE, PLUGIN_ID, SETTLE_DELAY_IN_MS, TEST_FILES },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();
    // The file's `work/*` hides `work/`, and the profile's own later negation re-includes one file of it.
    expect(result.imported).toStrictEqual(['work/keep.md', 'home/b.md']);
    expect(result.edited).toStrictEqual(['work/a.md', 'work/keep.md']);
    expect(result.removed).toStrictEqual(TEST_FILES);
  });
});
