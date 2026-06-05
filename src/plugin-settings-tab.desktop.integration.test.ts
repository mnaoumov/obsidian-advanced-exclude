import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup';
import {
  describe,
  expect,
  it
} from 'vitest';

describe('PluginSettingsTab', () => {
  it('should open the file settings tab when "Go to settings" button is clicked', async () => {
    const result = await evalInObsidian({
      fn({ app }) {
        const plugin = app.plugins.getPlugin('advanced-exclude');
        if (!plugin) {
          return { error: 'Plugin not loaded' };
        }

        const settingTab = app.setting.pluginTabs.find((tab) => tab.id === plugin.manifest.id);
        if (!settingTab) {
          return { error: 'Settings tab not found' };
        }

        app.setting.open();
        app.setting.openTabById(plugin.manifest.id);
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- Not ready to migrate `display()`.
        settingTab.display();

        const buttons = Array.from(settingTab.containerEl.querySelectorAll('button'));
        const goToSettingsButton = buttons.find((btn) => btn.textContent === 'Go to settings');
        if (!goToSettingsButton) {
          return { error: 'Go to settings button not found' };
        }

        goToSettingsButton.click();

        const activeTab = app.setting.activeTab;
        app.setting.close();

        return {
          activeTabId: activeTab?.id,
          error: null
        };
      },
      vaultPath: getTempVault().path
    });

    expect(result.error).toBeNull();
    expect(result.activeTabId).toBe('file');
  });
});
