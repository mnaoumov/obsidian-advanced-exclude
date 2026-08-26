import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

/**
 * Regression guard for issue #14 — `data.json` was emptied and then re-filled with defaults on every
 * reload once the user changed a setting, silently reverting their change. It alternated `{}` <-> the
 * full default set, so a single reload could land on the half that looks correct; this drives several
 * consecutive reloads and checks the file after each one.
 *
 * Root cause (fixed in `obsidian-dev-utils` 94.6.0, shipped here from 4.0.0 onwards): `PluginBase.onload`
 * adds a placeholder `PluginSettingsComponentBase` typed on `Object` before `onloadImpl` installs the
 * real one. Knowing no property names, it could only serialize `{}`, and the normalizing save at the end
 * of `loadFromFile` — which exists to persist migrations — wrote that `{}` over the real settings.
 *
 * The reporter's steps say "Reload app without saving". The harness has no app-reload primitive, and it
 * does not need one: the placeholder is created on every plugin **enable**, not only on app startup, so
 * a disable/enable pass exercises exactly the same code path.
 */

interface TraversableComponent {
  readonly _children?: readonly unknown[];
}

const PLUGIN_ID = 'advanced-exclude';

/**
 * The failure under test is a write that must NOT happen, and no positive readiness signal can bound
 * the absence of one — so each reload is followed by a fixed beat for any stray asynchronous save to
 * land before the file is read.
 */
const SETTLE_DELAY_IN_MS = 5000;

const PLUGIN_READY_TIMEOUT_IN_MS = 30_000;
const RELOAD_COUNT = 3;

describe('Settings persistence', () => {
  it('should keep a changed setting in data.json across repeated reloads', async () => {
    const result = await evalInObsidian({
      async callback({
        app,
        lib: { waitUntil },
        PLUGIN_ID: pluginId,
        PLUGIN_READY_TIMEOUT_IN_MS: pluginReadyTimeout,
        RELOAD_COUNT: reloadCount,
        SETTLE_DELAY_IN_MS: settleDelay
      }) {
        const dataJsonPath = `${app.vault.configDir}/plugins/${pluginId}/data.json`;
        const afterReloadRaws: (null | string)[] = [];

        // Start from the reporter's control state: a vault whose settings have never been touched.
        for (const path of [dataJsonPath, '.obsidianignore', '.gitignore']) {
          if (await app.vault.adapter.exists(path)) {
            await app.vault.adapter.remove(path);
          }
        }

        await reloadPlugin();

        if (!getSettingsComponent()) {
          return {
            afterReloadRaws,
            afterToggleRaw: null,
            controlRaw: null,
            error: 'Could not locate PluginSettingsComponent'
          };
        }

        // Control: an untouched plugin writes no `data.json` at all.
        const controlRaw = await readDataJson();

        // Trigger: move one setting away from its default. 4.0.0 flipped the default of
        // `shouldIncludeGitIgnorePatterns` to `false`, so enabling it is now what the original report
        // Achieved by disabling it.
        await editSettings(true);
        const afterToggleRaw = await readDataJson();

        for (let index = 0; index < reloadCount; index++) {
          await reloadPlugin();
          afterReloadRaws.push(await readDataJson());
        }

        // `editAndSave` persists to a `data.json` that outlives this test — put the shipped default
        // Back for the rest of the suite.
        await editSettings(false);

        return {
          afterReloadRaws,
          afterToggleRaw,
          controlRaw,
          error: null
        };

        async function editSettings(shouldIncludeGitIgnorePatterns: boolean): Promise<void> {
          await getSettingsComponent()?.editAndSave((settings) => {
            settings.shouldIncludeGitIgnorePatterns = shouldIncludeGitIgnorePatterns;
          });
        }

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

        function getSettingsComponent(): PluginSettingsComponent | undefined {
          const plugin = app.plugins.getPlugin(pluginId);
          if (!plugin) {
            return undefined;
          }

          return findComponent(plugin, 'PluginSettingsComponent') as PluginSettingsComponent | undefined;
        }

        async function readDataJson(): Promise<null | string> {
          if (!await app.vault.adapter.exists(dataJsonPath)) {
            return null;
          }

          return await app.vault.adapter.read(dataJsonPath);
        }

        async function reloadPlugin(): Promise<void> {
          await app.plugins.disablePluginAndSave(pluginId);
          await app.plugins.enablePluginAndSave(pluginId);
          await waitUntil({
            message: 'the reloaded plugin to expose its settings component',
            predicate: () => Boolean(getSettingsComponent()),
            timeoutInMilliseconds: pluginReadyTimeout
          });
          await sleep(settleDelay);
        }
      },
      input: {
        PLUGIN_ID,
        PLUGIN_READY_TIMEOUT_IN_MS,
        RELOAD_COUNT,
        SETTLE_DELAY_IN_MS
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result.error).toBeNull();

    // A plugin whose settings were never changed writes nothing.
    expect(result.controlRaw).toBeNull();

    // The change itself reaches disk.
    expect(result.afterToggleRaw).not.toBeNull();
    expect(JSON.parse(result.afterToggleRaw ?? '{}')).toMatchObject({ shouldIncludeGitIgnorePatterns: true });

    // And survives every reload, without the file ever being emptied on the way.
    expect(result.afterReloadRaws).toHaveLength(RELOAD_COUNT);
    for (const raw of result.afterReloadRaws) {
      expect(raw).not.toBeNull();
      expect(raw?.trim()).not.toBe('{}');
      expect(JSON.parse(raw ?? '{}')).toMatchObject({ shouldIncludeGitIgnorePatterns: true });
    }
  });
});
