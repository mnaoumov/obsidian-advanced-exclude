import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { ExcludeMode } from './plugin-settings.ts';

/*
 * Regression guard for issue #8: a "hide almost everything" config change (the
 * `*` + whitelist idiom from the reported video) must scale with the real index
 * work, not with the vault size times the paint-frame cadence.
 *
 * The projection's apply loop yields cooperatively to keep the progress bar
 * repainting. Each `await requestAnimationFrameAsync()` costs ~one frame (~16 ms),
 * so a per-N-items yield cadence made the loop's wall-clock ~= itemCount / N frames:
 * a whole-vault hide of ~90k paths spent ~4,500 frames (~72 s) yielding while the
 * real index work (recompute + direct index mutation) was well under a second. The
 * yield cadence is now time-based, so the whole operation costs a small, bounded
 * amount per path regardless of vault size.
 *
 * This asserts the per-path cost stays under MAX_MS_PER_PATH. Before the fix the
 * cost was ~0.9 ms/path (~11.7 s at 12k, ~72 s at 90k); after it is ~0.01 ms/path.
 * Size is AE_PERF_VAULT_SIZE (default 90k).
 */

interface HideResult {
  readonly error: null | string;
  readonly loadedAfter?: number;
  readonly loadedBefore?: number;
  readonly remainingBig?: number;
  readonly totalMs?: number;
}

interface TraversableComponent {
  readonly _children?: readonly unknown[];
}

const PLUGIN_ID = 'advanced-exclude';
const SCENARIO_TIMEOUT_IN_MS = 595_000;
const SETTLE_POLL_IN_MS = 2000;
const SETTLE_MAX_POLLS = 60;
// Before the time-based yield fix the cost was ~0.9 ms/path; after, ~0.01 ms/path.
// A 0.2 ms/path ceiling sits well above the fixed cost yet far below the regression.
const MAX_MS_PER_PATH = 0.2;

describe('Full-mode hide-almost-everything scales with work, not vault size (issue #8)', () => {
  it('hides the whole vault in bounded per-path time via the `*` whitelist idiom', async () => {
    const vaultPath = getTemporaryVault().path;

    // Settle across short eval calls until the loaded-file count is stable. Each poll sleeps
    // In-page (harness `sleep`) then returns the count, so no single eval spans both the
    // Wait and the hide (which would exceed the CDP command timeout) and no Node timer is
    // Imported. A single eval that both waits and hides would exceed the CDP command timeout.
    let previous = -1;
    for (let poll = 0; poll < SETTLE_MAX_POLLS; poll++) {
      const count = await evalInObsidian({
        async callback({ app, pollMs }): Promise<number> {
          await sleep(pollMs);
          return app.vault.getAllLoadedFiles().length;
        },
        input: { pollMs: SETTLE_POLL_IN_MS },
        vaultPath
      });
      if (count === previous) {
        break;
      }
      previous = count;
    }

    const result = await evalInObsidian({
      async callback({ app, fullMode, PLUGIN_ID: pluginId }): Promise<HideResult> {
        const plugin = app.plugins.getPlugin(pluginId);
        if (!plugin) {
          return { error: 'Plugin not loaded' };
        }

        const ignorePatternsComponent = findComponent(plugin, 'IgnorePatternsComponent') as IgnorePatternsComponent | undefined;
        const pluginSettingsComponent = findComponent(plugin, 'PluginSettingsComponent') as PluginSettingsComponent | undefined;
        if (!ignorePatternsComponent || !pluginSettingsComponent) {
          return { error: 'Could not locate plugin components' };
        }

        const loadedBefore = app.vault.getAllLoadedFiles().length;
        const totalT0 = performance.now();
        await pluginSettingsComponent.editAndSave((settings) => {
          settings.excludeMode = fullMode;
          // The reported idiom: ignore everything, keep only the root control note.
          settings.obsidianIgnoreContent = '*\n!keep-real.md\n';
        });
        await ignorePatternsComponent.processConfigChanges();
        const totalMs = performance.now() - totalT0;

        return {
          error: null,
          loadedAfter: app.vault.getAllLoadedFiles().length,
          loadedBefore,
          remainingBig: app.vault.getFiles().filter((file) => file.path.startsWith('big/')).length,
          totalMs
        };

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
      input: { fullMode: ExcludeMode.Full, PLUGIN_ID },
      vaultPath
    });

    expect(result.error).toBeNull();
    const loadedBefore = result.loadedBefore ?? 0;
    // The vault really was populated and indexed before the hide.
    expect(loadedBefore).toBeGreaterThan(1000);
    // Full mode removed the whole ignored tree from Obsidian's index.
    expect(result.remainingBig).toBe(0);
    // The whole operation scales with work, not vault-size × paint cadence.
    expect(result.totalMs).toBeLessThan(loadedBefore * MAX_MS_PER_PATH);
  }, SCENARIO_TIMEOUT_IN_MS);
});
