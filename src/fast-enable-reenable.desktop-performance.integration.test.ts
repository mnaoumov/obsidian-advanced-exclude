import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { ExcludeMode } from './plugin-settings.ts';

/*
 * Fast-enable (issue #10 enable half, T125) in real Obsidian on the ISOLATED synthetic
 * performance vault — ONLY this plugin, so behavior is attributed purely to us (no
 * other-plugin confound) and reproducibly, without touching any real vault.
 *
 * One contiguous eval, so enable/disable state and timing are uninterrupted:
 *   1. Full mode + ignore `big/dir-0/` → a full projection persists the hidden set + a
 *      universe signature; the folder leaves Obsidian's index.
 *   2. `disablePlugin` → the hidden set is restored from snapshots (T124).
 *   3. `enablePlugin` with the config AND file universe unchanged → the FAST path
 *      (`fastEnableApplied === true`) re-hides the persisted set directly, no whole-vault
 *      rebuild/recompute. Must be correct.
 *   4. `disablePlugin`, then create a NEW file under the ignored folder on disk (the
 *      "changed while disabled" case the ignore-mtime fingerprint cannot see), then
 *      `enablePlugin` → the universe signature no longer matches, so the guard falls back
 *      to the full projection (`fastEnableApplied === false`) and the new file IS hidden.
 *
 * The deterministic `fastEnableApplied` signal is the robust proof the optimization
 * engaged (raw re-enable wall-clock is dominated by the fixed plugin-reload overhead and
 * only diverges at large sizes, so it is not asserted).
 */

const PLUGIN_ID = 'advanced-exclude';
const VAULT_CONTROL = 'keep-real.md';
// The first folder the populate spec creates (FILES_PER_FOLDER notes under it).
const HIDDEN_DIR = 'big/dir-0';
const INTRUDER_PATH = 'big/dir-0/intruder-while-disabled.md';
// A visible note (outside the hidden folder) whose inbound link points INTO it — the
// Populate spec makes `big/dir-N/file-0.md` link to `big/dir-0/file-0`. Hiding the folder
// Must demote this link to unresolved; restoring it must promote it back.
const LINK_SOURCE = 'big/dir-1/file-0.md';
const LINK_TARGET = 'big/dir-0/file-0.md';

const SETTLE_POLL_IN_MS = 2000;
const SETTLE_MAX_POLLS = 60;
const REENABLE_POLL_IN_MS = 50;
const REENABLE_MAX_WAIT_IN_MS = 120_000;
const MIN_EXPECTED_FILES = 100;
const SCENARIO_TIMEOUT_IN_MS = 595_000;

interface IndexProjectionLike {
  readonly fastEnableApplied?: boolean;
}

interface ReEnableResult {
  readonly controlVisibleAfterFast?: boolean;
  readonly error: null | string;
  readonly fastEnableAppliedOnFast?: boolean;
  readonly fastEnableAppliedOnFull?: boolean;
  readonly hiddenAfterApply?: number;
  readonly hiddenAfterFastReEnable?: number;
  readonly hiddenAfterFullReEnable?: number;
  readonly intruderHiddenAfterFull?: boolean;
  readonly linkStateAfterFastReEnable?: 'none' | 'resolved' | 'unresolved';
  readonly linkStateWhenRestored?: 'none' | 'resolved' | 'unresolved';
  readonly loadedBefore?: number;
  readonly restoredAfterDisable?: number;
}

interface TraversableComponent {
  readonly _children?: readonly unknown[];
}

describe('Fast enable — re-hides the persisted set directly on unchanged config (issue #10)', () => {
  it('takes the fast path on an unchanged re-enable and falls back to full when the vault changed while disabled', async () => {
    const vaultPath = getTempVault().path;

    // Wait out Obsidian's startup scan (across short eval calls so no single call spans
    // The whole wait) until the loaded-file count is stable.
    let previous = -1;
    for (let poll = 0; poll < SETTLE_MAX_POLLS; poll++) {
      const count = await evalInObsidian({
        args: { pollMs: SETTLE_POLL_IN_MS },
        async fn({ app, pollMs }): Promise<number> {
          await sleep(pollMs);
          return app.vault.getAllLoadedFiles().length;
        },
        vaultPath
      });
      if (count === previous) {
        break;
      }
      previous = count;
    }

    const result = await evalInObsidian({
      args: {
        CONTROL: VAULT_CONTROL,
        fullMode: ExcludeMode.Full,
        HIDDEN_DIR,
        INTRUDER_PATH,
        LINK_SOURCE,
        LINK_TARGET,
        PLUGIN_ID,
        pollMs: REENABLE_POLL_IN_MS,
        reEnableMaxWaitMs: REENABLE_MAX_WAIT_IN_MS
      },
      async fn({
        app,
        CONTROL: controlPath,
        fullMode,
        HIDDEN_DIR: hiddenDir,
        INTRUDER_PATH: intruderPath,
        LINK_SOURCE: linkSource,
        LINK_TARGET: linkTarget,
        PLUGIN_ID: pluginId,
        pollMs,
        reEnableMaxWaitMs
      }): Promise<ReEnableResult> {
        const hiddenPrefix = `${hiddenDir}/`;

        const loadedBefore = app.vault.getAllLoadedFiles().length;

        const plugin = app.plugins.getPlugin(pluginId);
        if (!plugin) {
          return { error: 'Plugin not loaded' };
        }
        const ignorePatternsComponent = findComponent(plugin, 'IgnorePatternsComponent') as IgnorePatternsComponent | undefined;
        const pluginSettingsComponent = findComponent(plugin, 'PluginSettingsComponent') as PluginSettingsComponent | undefined;
        if (!ignorePatternsComponent || !pluginSettingsComponent) {
          return { error: 'Could not locate plugin components' };
        }

        // 1. Full-mode hide of one folder → persists the hidden set + universe signature.
        await pluginSettingsComponent.editAndSave((settings) => {
          settings.excludeMode = fullMode;
          settings.obsidianIgnoreContent = `${hiddenPrefix}\n`;
        });
        await ignorePatternsComponent.processConfigChanges();
        const hiddenAfterApply = countHidden();

        // 2. Disable → restore from snapshots. The inbound link into the folder is promoted
        //    Back to resolved.
        await app.plugins.disablePlugin(pluginId);
        const restoredAfterDisable = countHidden();
        const linkStateWhenRestored = linkState(linkSource, linkTarget);

        // 3. Re-enable unchanged → FAST path. The folder is re-hidden and its inbound link
        //    Demoted to unresolved again.
        await reEnableUntilHidden();
        const fastEnableAppliedOnFast = fastEnableAppliedOf();
        const hiddenAfterFastReEnable = countHidden();
        const controlVisibleAfterFast = isControlVisible();
        const linkStateAfterFastReEnable = linkState(linkSource, linkTarget);

        // 4. Disable, change the universe on disk (a new ignored file the fingerprint
        //    Cannot detect), re-enable → the signature guard forces the FULL path.
        await app.plugins.disablePlugin(pluginId);
        await app.vault.create(intruderPath, '');
        await reEnableUntilHidden();
        const fastEnableAppliedOnFull = fastEnableAppliedOf();
        const hiddenAfterFullReEnable = countHidden();
        const intruderHiddenAfterFull = !isIntruderIndexed();

        return {
          controlVisibleAfterFast,
          error: null,
          fastEnableAppliedOnFast,
          fastEnableAppliedOnFull,
          hiddenAfterApply,
          hiddenAfterFastReEnable,
          hiddenAfterFullReEnable,
          intruderHiddenAfterFull,
          linkStateAfterFastReEnable,
          linkStateWhenRestored,
          loadedBefore,
          restoredAfterDisable
        };

        function countHidden(): number {
          return app.vault.getFiles().filter((file) => file.path.startsWith(hiddenPrefix)).length;
        }

        function isControlVisible(): boolean {
          return app.vault.getFiles().some((file) => file.path === controlPath);
        }

        function isIntruderIndexed(): boolean {
          return app.vault.getFiles().some((file) => file.path === intruderPath);
        }

        function fastEnableAppliedOf(): boolean {
          const reEnabledPlugin = app.plugins.getPlugin(pluginId);
          const component = reEnabledPlugin
            ? findComponent(reEnabledPlugin, 'IndexProjectionComponent') as IndexProjectionLike | undefined
            : undefined;
          return component?.fastEnableApplied ?? false;
        }

        // Re-enable and wait until the folder's files are hidden again (enablePlugin may
        // Resolve before the async projection finishes).
        async function reEnableUntilHidden(): Promise<void> {
          const t0 = performance.now();
          await app.plugins.enablePlugin(pluginId);
          while (countHidden() > 0 && performance.now() - t0 < reEnableMaxWaitMs) {
            await sleep(pollMs);
          }
        }

        function linkState(source: string, target: string): 'none' | 'resolved' | 'unresolved' {
          const { metadataCache } = app;
          if ((metadataCache.resolvedLinks[source]?.[target] ?? 0) > 0) {
            return 'resolved';
          }
          if ((metadataCache.unresolvedLinks[source]?.[target] ?? 0) > 0) {
            return 'unresolved';
          }
          return 'none';
        }

        function findComponent(root: object, className: string): unknown {
          if (root.constructor.name === className) {
            return root;
          }
          for (const child of (root as TraversableComponent)._children ?? []) {
            if (typeof child === 'object' && child !== null) {
              const found = findComponent(child, className);
              if (found) {
                return found;
              }
            }
          }
          return undefined;
        }
      },
      vaultPath
    });

    expect(result.error).toBeNull();
    // The vault really was populated and indexed.
    expect(result.loadedBefore ?? 0).toBeGreaterThan(MIN_EXPECTED_FILES);
    // 1. The initial full-mode hide removed the whole folder from the index.
    expect(result.hiddenAfterApply).toBe(0);
    // 2. Disable restored the folder to the index.
    expect(result.restoredAfterDisable).toBeGreaterThan(0);
    // 3. Unchanged re-enable took the FAST path and re-hid the folder correctly.
    expect(result.fastEnableAppliedOnFast).toBe(true);
    expect(result.hiddenAfterFastReEnable).toBe(0);
    expect(result.controlVisibleAfterFast).toBe(true);
    // Inbound links into the folder were promoted back on disable, then demoted again by
    // The fast re-hide — the `demoteInboundLinks`/`promoteInboundLinks` path a link-free
    // Vault never exercised.
    expect(result.linkStateWhenRestored).toBe('resolved');
    expect(result.linkStateAfterFastReEnable).toBe('unresolved');
    // 4. After a change while disabled the universe signature no longer matches, so the
    //    Guard fell back to the full projection, which hid the new file too.
    expect(result.fastEnableAppliedOnFull).toBe(false);
    expect(result.hiddenAfterFullReEnable).toBe(0);
    expect(result.intruderHiddenAfterFull).toBe(true);
  }, SCENARIO_TIMEOUT_IN_MS);
});
