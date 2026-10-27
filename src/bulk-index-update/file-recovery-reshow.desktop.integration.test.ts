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
const HIDDEN_FOLDER = 'file-recovery-reshow';
const NOTE_PATHS = ['file-recovery-reshow/one.md', 'file-recovery-reshow/two.md', 'file-recovery-reshow/three.md'];

interface BackupDatabase {
  readonly transaction: (storeName: string, mode: string) => BackupTransaction;
}

interface BackupIndex {
  readonly getAll: (path: string) => Promise<unknown[]>;
}

interface BackupStore {
  readonly index: (name: string) => BackupIndex;
}

interface BackupTransaction {
  readonly store: BackupStore;
}

interface FileRecoveryInstance {
  readonly clearData: () => void;
  // eslint-disable-next-line unicorn/name-replacements -- `db` is the File recovery plugin's own member name.
  readonly db: BackupDatabase | null;
  readonly pendingFiles: Set<string>;
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

describe('re-showing notes hidden by an earlier session', () => {
  it('records no File recovery snapshot for them', async () => {
    const result = await evalInObsidian({
      async callback({ app, HIDDEN_FOLDER: hiddenFolder, NOTE_PATHS: notePaths, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay }) {
        const fileRecovery = app.internalPlugins.getEnabledPluginById('file-recovery') as FileRecoveryInstance | null;
        const plugin = app.plugins.getPlugin(pluginId) as null | PluginWithSettingsComponent;
        if (!fileRecovery?.db || !plugin) {
          return { error: `File recovery database: ${String(Boolean(fileRecovery?.db))}, plugin: ${String(Boolean(plugin))}` };
        }

        await app.vault.adapter.mkdir(hiddenFolder);
        for (const notePath of notePaths) {
          await app.vault.adapter.write(notePath, `content of ${notePath}`);
        }
        await sleep(settleDelay);

        await plugin.pluginSettingsComponent.editAndSave((settings) => {
          settings.ignorePatterns = `${hiddenFolder}/\n`;
        });
        await sleep(settleDelay);
        const visibleWhileHidden = notePaths.filter((notePath) => app.vault.getAbstractFileByPath(notePath) !== null);

        // An earlier session's hide leaves no in-memory snapshot, so the un-ignore below re-parses each note through
        // `reconcileFile`, which fires `create` for it. Dropping the snapshots takes that path without an app reload.
        const hider = findManualIndexHider(plugin);
        if (!hider) {
          return { error: 'ManualIndexHider not found' };
        }
        hider.snapshots.clear();
        // Forget the snapshots File recovery took when the notes were written, so a re-show snapshot would be taken now.
        fileRecovery.clearData();

        await plugin.pluginSettingsComponent.editAndSave((settings) => {
          settings.ignorePatterns = '';
        });
        await sleep(settleDelay);

        const visibleAfterReShow = notePaths.filter((notePath) => app.vault.getAbstractFileByPath(notePath) !== null);
        const database = fileRecovery.db;
        let backupCount = 0;
        for (const notePath of notePaths) {
          const backups = await database.transaction('backups', 'readonly').store.index('path').getAll(notePath);
          backupCount += backups.length;
        }
        const pendingCount = notePaths.filter((notePath) => fileRecovery.pendingFiles.has(notePath)).length;
        return { backupCount, error: null, pendingCount, visibleAfterReShow, visibleWhileHidden };

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
        SETTLE_DELAY_IN_MS
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result).toEqual({
      backupCount: 0,
      error: null,
      pendingCount: 0,
      visibleAfterReShow: NOTE_PATHS,
      visibleWhileHidden: []
    });
  });
});
