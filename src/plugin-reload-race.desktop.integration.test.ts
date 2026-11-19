import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsComponent } from './settings/plugin-settings-component.ts';

/**
 * Regression guard for a `Plugin failure: advanced-exclude AggregateError: Component is already unloaded`
 * seen while Obsidian updated the plugin. Obsidian's `loadPlugin` registers the new instance before it
 * awaits `load()`, so a `disablePlugin` that arrives while `onloadImpl` is still awaiting unloads the
 * instance mid-load. Before `@mnaoumov/obsidian-lib` 11.0.0 the next `addChild` in `onloadImpl` threw,
 * and Obsidian marked the plugin as failed even though the instance had been torn down correctly.
 *
 * The test drives the same shape as an update: enable, then disable and enable again before the first
 * load settles. It asserts that nothing reports a plugin failure, that exactly the last instance stays
 * loaded, and that the ignored file is still hidden.
 */

interface PluginWithSettingsComponent {
  readonly _loaded: boolean;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface RaceResult {
  readonly interruptedPlugin: null | PluginWithSettingsComponent;
  readonly wasInterruptedMidLoad: boolean;
}

const PLUGIN_ID = 'advanced-exclude';
const SETTLE_DELAY_IN_MS = 5000;
const HIDDEN_FILE = 'race-secret.md';
const VISIBLE_FILE = 'race-visible.md';

afterEach(async () => {
  await evalInObsidian({
    async callback({ app, FILES: files, PLUGIN_ID: pluginId }) {
      // The global patterns live in the synced `data.json`, which outlives a test.
      const plugin = app.plugins.getPlugin(pluginId) as null | PluginWithSettingsComponent;
      await plugin?.pluginSettingsComponent.editAndSave((settings) => {
        settings.ignorePatterns = '';
      });
      for (const path of files) {
        try {
          await app.vault.adapter.remove(path);
        } catch {
          // Ignore
        }
      }
    },
    input: {
      FILES: [HIDDEN_FILE, VISIBLE_FILE],
      PLUGIN_ID
    },
    vaultPath: getTemporaryVault().path
  });
});

describe('Plugin reload race', () => {
  it('should load cleanly when it is disabled and enabled again while its first load is in flight', async () => {
    const result = await evalInObsidian({
      async callback({
        app,
        HIDDEN_FILE: hiddenFile,
        PLUGIN_ID: pluginId,
        SETTLE_DELAY_IN_MS: settleDelay,
        VISIBLE_FILE: visibleFile
      }) {
        const initialPlugin = app.plugins.getPlugin(pluginId) as null | PluginWithSettingsComponent;
        if (!initialPlugin) {
          return { error: 'Plugin not loaded' };
        }

        await app.vault.adapter.write(hiddenFile, 'I should be hidden');
        await app.vault.adapter.write(visibleFile, 'I should be visible');
        await initialPlugin.pluginSettingsComponent.editAndSave((settings) => {
          settings.ignorePatterns = 'race-secret*\n';
        });
        await app.plugins.disablePlugin(pluginId);
        await app.plugins.enablePlugin(pluginId);
        await sleep(settleDelay);

        const failureMessages: string[] = [];
        const restoreConsoleError = captureFailureMessages(failureMessages);
        let raceResult: RaceResult;
        try {
          raceResult = await reloadDuringLoad();
          await sleep(settleDelay);
        } finally {
          restoreConsoleError();
        }

        const { interruptedPlugin, wasInterruptedMidLoad } = raceResult;
        const finalPlugin = app.plugins.getPlugin(pluginId) as null | PluginWithSettingsComponent;
        return {
          error: null,
          failureMessages,
          hasFinalPlugin: Boolean(finalPlugin),
          isEnabled: app.plugins.enabledPlugins.has(pluginId),
          isFinalPluginLoaded: finalPlugin?._loaded ?? false,
          isFinalPluginNew: Boolean(finalPlugin) && finalPlugin !== interruptedPlugin,
          isHiddenFileIndexed: Boolean(app.vault.getAbstractFileByPath(hiddenFile)),
          isInterruptedPluginLoaded: interruptedPlugin?._loaded ?? null,
          isVisibleFileIndexed: Boolean(app.vault.getAbstractFileByPath(visibleFile)),
          wasInterruptedMidLoad
        };

        function captureFailureMessages(messages: string[]): () => void {
          const originalConsoleError = console.error;
          console.error = (...errorArguments: unknown[]): void => {
            const text = errorArguments.map((value) => value instanceof Error ? `${value.name}: ${value.message}` : String(value)).join(' ');
            if (text.includes('Plugin failure') || text.includes('already unloaded') || text.includes('Error loading plugin')) {
              messages.push(text);
            }
            originalConsoleError.apply(console, errorArguments);
          };
          return () => {
            console.error = originalConsoleError;
          };
        }

        async function reloadDuringLoad(): Promise<RaceResult> {
          await app.plugins.disablePlugin(pluginId);

          const firstEnableState = { hasSettled: false };
          const firstEnablePromise = app.plugins.enablePlugin(pluginId).finally(() => {
            firstEnableState.hasSettled = true;
          });
          // Obsidian registers the instance before it awaits `load()`; unload it as soon as it appears.
          while (!getRegisteredPlugin() && !firstEnableState.hasSettled) {
            await new Promise((resolve) => {
              setTimeout(resolve, 0);
            });
          }
          const raceOutcome: RaceResult = {
            interruptedPlugin: getRegisteredPlugin(),
            wasInterruptedMidLoad: !firstEnableState.hasSettled
          };
          await app.plugins.disablePlugin(pluginId);
          await app.plugins.enablePlugin(pluginId);
          await firstEnablePromise;
          return raceOutcome;
        }

        function getRegisteredPlugin(): null | PluginWithSettingsComponent {
          return (app.plugins.plugins[pluginId] ?? null) as null | PluginWithSettingsComponent;
        }
      },
      input: {
        HIDDEN_FILE,
        PLUGIN_ID,
        SETTLE_DELAY_IN_MS,
        VISIBLE_FILE
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();
    expect(result.wasInterruptedMidLoad).toBe(true);
    expect(result.failureMessages).toEqual([]);
    expect(result.isEnabled).toBe(true);
    expect(result.hasFinalPlugin).toBe(true);
    expect(result.isFinalPluginNew).toBe(true);
    expect(result.isFinalPluginLoaded).toBe(true);
    expect(result.isInterruptedPluginLoaded).toBe(false);
    expect(result.isHiddenFileIndexed).toBe(false);
    expect(result.isVisibleFileIndexed).toBe(true);
  });
});
