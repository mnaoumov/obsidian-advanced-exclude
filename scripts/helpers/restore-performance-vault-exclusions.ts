import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';

import type { IgnorePatternsComponent } from '../../src/ignore-patterns-component.ts';
import type { PluginSettingsComponent } from '../../src/plugin-settings-component.ts';

interface TraversableComponent {
  readonly _children?: readonly unknown[];
}

const PLUGIN_ID = 'advanced-exclude';

/**
 * Clears the plugin's ignore patterns and re-applies them, so the whole performance vault is visible
 * again.
 *
 * Every `integration-tests:desktop-performance` suite shares ONE populated vault and ONE Obsidian
 * instance, and most of them end by hiding part or all of it. Without this, whichever suite runs next
 * opens a vault that is already hidden and fails on its "the vault really was populated" assertion,
 * reporting `0` or `2` indexed files where ~90k were written.
 *
 * The exclude mode is deliberately left as the suite set it. Every suite sets its own mode, and
 * switching `FilesPane` back to `Full` in the same step is a whole-vault reprojection that did not
 * finish inside the 600s hook budget at ~90k files, leaving the next suite a half-restored vault.
 */
export async function restorePerformanceVaultExclusions(): Promise<void> {
  await evalInObsidian({
    async callback({ app, PLUGIN_ID: pluginId }) {
      const plugin = app.plugins.getPlugin(pluginId);
      if (!plugin) {
        return;
      }

      const ignorePatternsComponent = findComponent(plugin, 'IgnorePatternsComponent') as IgnorePatternsComponent | undefined;
      const pluginSettingsComponent = findComponent(plugin, 'PluginSettingsComponent') as PluginSettingsComponent | undefined;
      if (!ignorePatternsComponent || !pluginSettingsComponent) {
        return;
      }

      await pluginSettingsComponent.editAndSave((settings) => {
        settings.obsidianIgnoreContent = '';
      });
      await ignorePatternsComponent.processConfigChanges();

      function findComponent(root: object, className: string): unknown {
        if (root.constructor.name === className) {
          return root;
        }
        for (const child of (root as TraversableComponent)._children ?? []) {
          if (typeof child !== 'object' || child === null) {
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
    input: { PLUGIN_ID },
    vaultPath: getTemporaryVault().path
  });
}
