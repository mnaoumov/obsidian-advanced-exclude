import { setTimeout as sleepInNode } from 'node:timers/promises';
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
 *
 * Each step runs in its own evaluation, driven from Node, so no single evaluation waits longer than the
 * plugin-ready ceiling below: the transport fails any evaluation past 30 000 ms as a bare script timeout.
 */

type StepAction = 'enable-setting' | 'read' | 'reload' | 'reset' | 'restore-setting';

interface StepResult {
  readonly error: null | string;
  readonly raw: null | string;
}

interface TraversableComponent {
  readonly _children?: readonly unknown[];
}

const PLUGIN_ID = 'advanced-exclude';

/**
 * The failure under test is a write that must NOT happen, and no positive readiness signal can bound
 * the absence of one — so each reload is followed by a fixed beat for any stray asynchronous save to
 * land before the file is read. The beat runs in Node, between the reload evaluation and the read
 * evaluation.
 */
const SETTLE_DELAY_IN_MS = 5000;

/**
 * A disable/enable pass on the near-empty test vault completes in well under a second on desktop; the
 * ceiling leaves room for a slow Android emulator while staying under the 30 000 ms evaluation cap.
 */
const PLUGIN_READY_TIMEOUT_IN_MS = 20_000;
const RELOAD_COUNT = 3;

describe('Settings persistence', () => {
  it('should keep a changed setting in data.json across repeated reloads', async () => {
    // Start from the reporter's control state: a vault whose settings have never been touched.
    await runStep('reset');
    await reloadAndSettle();

    // Control: an untouched plugin writes no `data.json` at all.
    const controlRaw = await runStep('read');

    // Trigger: move one setting away from its default. 4.0.0 flipped the default of
    // `shouldIncludeGitIgnorePatterns` to `false`, so enabling it is now what the original report
    // achieved by disabling it.
    const afterToggleRaw = await runStep('enable-setting');

    const afterReloadRaws: (null | string)[] = [];
    try {
      for (let index = 0; index < RELOAD_COUNT; index++) {
        await reloadAndSettle();
        afterReloadRaws.push(await runStep('read'));
      }
    } finally {
      // `editAndSave` persists to a `data.json` that outlives this test — put the shipped default
      // back for the rest of the suite.
      await runStep('restore-setting');
    }

    // A plugin whose settings were never changed writes nothing.
    expect(controlRaw).toBeNull();

    // The change itself reaches disk.
    expect(afterToggleRaw).not.toBeNull();
    expect(JSON.parse(afterToggleRaw ?? '{}')).toMatchObject({ shouldIncludeGitIgnorePatterns: true });

    // And survives every reload, without the file ever being emptied on the way.
    expect(afterReloadRaws).toHaveLength(RELOAD_COUNT);
    for (const raw of afterReloadRaws) {
      expect(raw).not.toBeNull();
      expect(raw?.trim()).not.toBe('{}');
      expect(JSON.parse(raw ?? '{}')).toMatchObject({ shouldIncludeGitIgnorePatterns: true });
    }
  });
});

async function reloadAndSettle(): Promise<void> {
  await runStep('reload');
  await sleepInNode(SETTLE_DELAY_IN_MS);
}

/**
 * Runs one step of the scenario in its own evaluation and returns the raw `data.json` after it, or `null`
 * when the file is absent.
 */
async function runStep(action: StepAction): Promise<null | string> {
  const result = await evalInObsidian({
    async callback({
      ACTION: stepAction,
      app,
      lib: { waitUntil },
      PLUGIN_ID: pluginId,
      PLUGIN_READY_TIMEOUT_IN_MS: pluginReadyTimeout
    }): Promise<StepResult> {
      const dataJsonPath = `${app.vault.configDir}/plugins/${pluginId}/data.json`;

      switch (stepAction) {
        case 'enable-setting':
        case 'restore-setting': {
          const settingsComponent = getSettingsComponent();
          if (!settingsComponent) {
            return { error: 'Could not locate PluginSettingsComponent', raw: null };
          }

          await settingsComponent.editAndSave((settings) => {
            settings.shouldIncludeGitIgnorePatterns = stepAction === 'enable-setting';
          });
          break;
        }
        case 'read': {
          if (!getSettingsComponent()) {
            return { error: 'Could not locate PluginSettingsComponent', raw: null };
          }
          break;
        }
        case 'reload': {
          await app.plugins.disablePluginAndSave(pluginId);
          await app.plugins.enablePluginAndSave(pluginId);
          await waitUntil({
            message: 'the reloaded plugin to expose its settings component',
            predicate: () => Boolean(getSettingsComponent()),
            timeoutInMilliseconds: pluginReadyTimeout
          });
          break;
        }
        case 'reset': {
          for (const path of [dataJsonPath, '.obsidianignore', '.gitignore']) {
            if (await app.vault.adapter.exists(path)) {
              await app.vault.adapter.remove(path);
            }
          }
          break;
        }
        default: {
          return { error: `Unknown step: ${String(stepAction)}`, raw: null };
        }
      }

      return {
        error: null,
        raw: await app.vault.adapter.exists(dataJsonPath) ? await app.vault.adapter.read(dataJsonPath) : null
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

      function getSettingsComponent(): PluginSettingsComponent | undefined {
        const plugin = app.plugins.getPlugin(pluginId);
        return plugin ? (findComponent(plugin, 'PluginSettingsComponent') as PluginSettingsComponent | undefined) : undefined;
      }
    },
    input: {
      ACTION: action,
      PLUGIN_ID,
      PLUGIN_READY_TIMEOUT_IN_MS
    },
    vaultPath: getTemporaryVault().path
  });

  expect(result.error, `step '${action}'`).toBeNull();
  return result.raw;
}
