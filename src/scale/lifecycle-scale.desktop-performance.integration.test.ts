import { setTimeout as delay } from 'node:timers/promises';
import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterAll,
  describe,
  expect,
  it
} from 'vitest';

import type { IgnorePatternsComponent } from '../patterns/ignore-patterns-component.ts';
import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

import { restorePerformanceVaultExclusions } from '../../scripts/helpers/restore-performance-vault-exclusions.ts';
import { ExcludeMode } from '../settings/plugin-settings.ts';

/*
 * The whole user-facing lifecycle at a real vault's scale, measured step by step: a cold enable
 * (nothing persisted), a warm re-enable, a pattern that hides a large folder, and that pattern
 * removed again, both in the same session (snapshots held) and across sessions (no snapshot, the
 * `reconcileFile` re-show). Each step records its wall time, the main thread's long tasks (what
 * typing in a note during the step would feel) and the JS heap.
 *
 * By default it runs on the synthetic performance vault and hides `big`, its whole note tree. The
 * synthetic size (~90k) matches what Obsidian indexes of a real 115k-file vault, since dot-folders
 * are never indexed. For a real vault's shape, point `AE_PERF_VAULT_SOURCE` at a directory copy of
 * it (see `scripts/vitest-global-setup-performance.ts`) and `AE_PERF_SCENARIO_FOLDER` at one of its
 * large folders, and run this file alone.
 *
 * The ceilings are per path of the vault, so the guard scales with the vault. Measured on a copy of
 * a real vault (90,902 indexed nodes, a 30k-path folder), before → after the fixes this suite
 * guards: un-ignoring the folder took 16.4 s → 3.4 s in-session and ~20 min → 16 s across sessions
 * (both bounded by Obsidian re-sorting the whole explorer, and re-scanning every link, once per
 * path); a warm re-enable took 9 s → 0.1 s; the worst main-thread stall fell to ~0.3 s.
 *
 * An app start with the folder hidden is measured too, by reloading the window. On that copy it
 * took 274 s → 12.1 s (11.5 s with nothing ignored): Obsidian's metadata cache purged every hidden
 * path from its persisted cache one at a time, re-scanning every link per path. In `Full` mode the
 * start is followed by the real cross-session re-show it sets up. Those starts run first: in the
 * harness-owned instance a reload after the whole lifecycle never finished starting. A reload leaves
 * the old document's IndexedDB connections open for minutes, so the cold enable empties the plugin's
 * stores rather than deleting them; the plugin itself never deletes them.
 */

const PLUGIN_ID = 'advanced-exclude';
const SCENARIO_FOLDER = process.env['AE_PERF_SCENARIO_FOLDER'] ?? 'big';
const SETTLE_POLL_IN_MS = 2000;
const SETTLE_MAX_POLLS = 120;
const SCENARIO_TIMEOUT_IN_MS = 595_000;

// Several times the measured cost per vault path, and far below the regressions guarded: the
// per-path explorer re-sort cost ~0.5 ms per path, the per-path link re-scan ~30 ms.
const MAX_STEP_MS_PER_PATH = 0.1;
// A cross-session re-show re-reads and re-parses every file, which is Obsidian's own indexing cost:
// ~1.1 ms per path for the synthetic vault's whole tree, against ~40 ms before the fixes.
const MAX_CROSS_SESSION_SHOW_MS_PER_PATH = 3;
// The worst single main-thread task during any step: one this long is a visible freeze while
// typing. The per-path explorer re-sort produced ~1 s tasks a hundred times over.
const MAX_LONG_TASK_IN_MS = 1000;
// An app start is mostly Obsidian's own startup: ~0.04 ms per path on the synthetic vault, up to
// ~0.3 ms per path until the metadata queue drains. The per-path cache purge cost ~3 ms per path on
// the real-vault copy, and grows with the vault's size.
const MAX_RESTART_MS_PER_PATH = 1;
// Obsidian's own vault load held the main thread for 1-5 s on the synthetic vault; the purge held
// it for 268 s in one stretch.
const MAX_RESTART_STALL_IN_MS = 15_000;
// Leaves the scenario time to report the restart's numbers when it does not settle.
const RESTART_TIMEOUT_IN_MS = 300_000;

interface ExplorerViewLike {
  readonly fileItems?: Record<string, unknown>;
}

interface HiderLike {
  readonly snapshots: Map<string, unknown>;
}

interface MemoryLike {
  readonly usedJSHeapSize: number;
}

interface PerformanceWithMemory {
  readonly memory?: MemoryLike;
}

interface ProjectionLike {
  readonly applyingProjectionDepth: number;
  readonly fastEnableApplied: boolean;
  readonly hasBuiltModel: boolean;
  readonly manualIndexHider: HiderLike;
  readonly updateAbortController: AbortController | null;
}

interface StartupProbe {
  readonly explorerFolderItems: number;
  readonly folderFilesLoaded: number;
  readonly isSettled: boolean;
  readonly loadedFiles: number;
  readonly sinceNavigationMs: number;
  readonly timeOrigin: number;
}

type Step = 'coldEnable' | 'hide' | 'restart' | 'showCrossSession' | 'showSameSession' | 'switchMode' | 'warmReEnable';

interface StepResult {
  readonly disableMs?: number;
  readonly error: null | string;
  readonly explorerFolderItems?: number;
  readonly fastEnableApplied?: boolean;
  readonly folderFilesLoaded?: number;
  readonly heapAfterMb?: number;
  readonly heapBeforeMb?: number;
  readonly loadedFiles?: number;
  readonly longTaskCount?: number;
  readonly longTaskMaxMs?: number;
  readonly longTaskTotalMs?: number;
  readonly step: Step;
  readonly wallMs?: number;
}

interface TraversableComponent {
  readonly _children?: readonly unknown[];
}

// The vault is shared with every other suite in this project; leave it fully visible.
afterAll(restorePerformanceVaultExclusions);

// Declared first so these run first: see the header on why no reload may follow the lifecycle below.
describe('App start at real-vault scale with the folder hidden: startup stays bounded', () => {
  it.each([ExcludeMode.FilesPane, ExcludeMode.Full])('in %s mode', async (excludeMode) => {
    // After a real restart no hidden path has a snapshot, so the `Full` re-show is the real
    // cross-session one rather than the simulation the lifecycle below runs.
    const steps: Step[] = ['switchMode', 'hide', 'restart', excludeMode === ExcludeMode.Full ? 'showCrossSession' : 'showSameSession'];
    await runSteps(steps, excludeMode);
  }, SCENARIO_TIMEOUT_IN_MS);
});

describe('Lifecycle at real-vault scale: every step stays bounded', () => {
  it.each([ExcludeMode.Full, ExcludeMode.FilesPane])('in %s mode', async (excludeMode) => {
    const steps: Step[] = excludeMode === ExcludeMode.Full
      ? ['switchMode', 'coldEnable', 'warmReEnable', 'hide', 'showSameSession', 'hide', 'showCrossSession']
      : ['switchMode', 'hide', 'showSameSession'];
    await runSteps(steps, excludeMode);
  }, SCENARIO_TIMEOUT_IN_MS);
});

function getMaxMsPerPath(step: Step): number {
  switch (step) {
    case 'restart': {
      return MAX_RESTART_MS_PER_PATH;
    }
    case 'showCrossSession': {
      return MAX_CROSS_SESSION_SHOW_MS_PER_PATH;
    }
    default: {
      return MAX_STEP_MS_PER_PATH;
    }
  }
}

async function probeStartup(vaultPath: string, folder: string): Promise<StartupProbe> {
  return await evalInObsidian({
    callback({ app, folder: folderName, PLUGIN_ID: pluginId }): StartupProbe {
      const folderPrefix = `${folderName}/`;
      const plugin = app.plugins.getPlugin(pluginId);
      const projection = plugin ? findComponent(plugin, 'IndexProjectionComponent') as ProjectionLike | undefined : undefined;
      const explorerView = app.workspace.getLeavesOfType('file-explorer')[0]?.view as ExplorerViewLike | undefined;
      const loadedFiles = app.vault.getAllLoadedFiles();
      return {
        explorerFolderItems: Object.keys(explorerView?.fileItems ?? {}).filter((path) => path.startsWith(folderPrefix)).length,
        folderFilesLoaded: loadedFiles.filter((file) => file.path.startsWith(folderPrefix)).length,
        isSettled: app.workspace.layoutReady && app.metadataCache.inProgressTaskCount === 0
          && projection?.applyingProjectionDepth === 0 && projection.updateAbortController === null,
        loadedFiles: loadedFiles.length,
        sinceNavigationMs: Math.round(performance.now()),
        timeOrigin: performance.timeOrigin
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
    input: { folder, PLUGIN_ID },
    vaultPath
  });
}

/*
 * A real app start with the plugin enabled and the folder hidden: the window reloads, so the step
 * is measured from this side. Its wall time is the new document's own clock when the layout is
 * ready, the plugin idle and the metadata queue empty, so it includes Obsidian's own startup. No
 * long-task observer survives the reload, so the longest stall is the longest wait between two
 * answers to a 250 ms poll.
 */
async function restartApp(vaultPath: string, folder: string): Promise<StepResult> {
  const step = 'restart';
  const pollInMs = 250;
  const before = await probeStartup(vaultPath, folder);
  await evalInObsidian({
    callback() {
      // Deferred so this evaluation answers before the document goes away.
      window.setTimeout(() => {
        window.location.reload();
      }, 0);
    },
    vaultPath
  });

  const deadline = Date.now() + RESTART_TIMEOUT_IN_MS;
  let lastAnswerAt: null | number = null;
  let longestStallMs = 0;
  let lastProbe: StartupProbe | undefined;
  while (Date.now() < deadline) {
    let probe: StartupProbe | undefined;
    try {
      // A wedged document never answers, so a probe must not outlive the deadline.
      probe = await Promise.race([probeStartup(vaultPath, folder), delay(Math.max(0, deadline - Date.now())).then(() => undefined)]);
    } catch {
      // The document is between pages.
    }
    if (probe && probe.timeOrigin !== before.timeOrigin) {
      lastProbe = probe;
      const now = Date.now();
      if (lastAnswerAt !== null) {
        longestStallMs = Math.max(longestStallMs, now - lastAnswerAt - pollInMs);
      }
      lastAnswerAt = now;
      if (probe.isSettled) {
        return {
          error: null,
          explorerFolderItems: probe.explorerFolderItems,
          folderFilesLoaded: probe.folderFilesLoaded,
          loadedFiles: probe.loadedFiles,
          longTaskMaxMs: longestStallMs,
          step,
          wallMs: probe.sinceNavigationMs
        };
      }
    }
    // This side runs in Node, which has no `window`.
    await delay(pollInMs);
  }
  return { error: `${step} did not settle; last answer: ${JSON.stringify(lastProbe ?? null)}`, step };
}

async function runStep(vaultPath: string, step: Step, excludeMode: ExcludeMode): Promise<StepResult> {
  if (step === 'restart') {
    return await restartApp(vaultPath, SCENARIO_FOLDER);
  }
  return await evalInObsidian({
    async callback({ app, excludeMode: mode, folder, PLUGIN_ID: pluginId, step: currentStep }): Promise<StepResult> {
      const folderPrefix = `${folder}/`;
      const tailInMs = 3000;
      const doneTimeoutInMs = 540_000;
      const pollInMs = 250;
      const bytesPerMb = 1024 * 1024;

      const longTasks: number[] = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push(entry.duration);
        }
      });
      observer.observe({ entryTypes: ['longtask'] });

      const heapBeforeMb = getHeapMb();
      let disableMs: number | undefined;
      const t0 = performance.now();
      try {
        const plugin = app.plugins.getPlugin(pluginId);
        if (!plugin) {
          return { error: 'Plugin not loaded', step: currentStep };
        }
        const settingsComponent = findComponent(plugin, 'PluginSettingsComponent') as PluginSettingsComponent | undefined;
        const ignoreComponent = findComponent(plugin, 'IgnorePatternsComponent') as IgnorePatternsComponent | undefined;
        if (!settingsComponent || !ignoreComponent) {
          return { error: 'Could not locate plugin components', step: currentStep };
        }

        switch (currentStep) {
          case 'coldEnable': {
            await disableTimed();
            for (
              const name of [
                `${app.appId}/advanced-exclude`,
                `${app.appId}/advanced-exclude-vault-paths`,
                `obsidian-lib:${JSON.stringify([app.appId, pluginId, 'verdicts-v1'])}`,
                `obsidian-lib:${JSON.stringify([app.appId, pluginId, 'hidden-paths-v1'])}`
              ]
            ) {
              await emptyDatabase(name);
            }
            await enableAndWait();
            break;
          }
          case 'hide': {
            await setIgnoreContent(`${folderPrefix}\n`);
            break;
          }
          case 'showCrossSession': {
            // The state a restart leaves: the folder is hidden but this session holds no snapshot
            // of it, so a re-show must bring every file back from disk.
            const projection = findComponent(plugin, 'IndexProjectionComponent') as ProjectionLike | undefined;
            projection?.manualIndexHider.snapshots.clear();
            await setIgnoreContent('');
            // The re-show re-parses through Obsidian's own pipeline, so wait for the folder to be
            // back in the index before stopping the clock.
            await waitFor(() => app.metadataCache.inProgressTaskCount === 0 && countFolderFiles() > 0);
            break;
          }
          case 'showSameSession': {
            await setIgnoreContent('');
            break;
          }
          case 'switchMode': {
            await settingsComponent.editAndSave((settings) => {
              settings.excludeMode = mode;
              settings.ignorePatterns = '';
            });
            await ignoreComponent.processConfigChanges();
            break;
          }
          case 'warmReEnable': {
            await disableTimed();
            await enableAndWait();
            break;
          }
          default: {
            return { error: `Unknown step ${String(currentStep)}`, step: currentStep };
          }
        }
        const wallMs = performance.now() - t0;
        // Catch the long tasks a step leaves behind it, such as the debounced verdict-cache flush.
        await sleep(tailInMs);
        const enabledPlugin = app.plugins.getPlugin(pluginId);
        const projection = enabledPlugin && findComponent(enabledPlugin, 'IndexProjectionComponent') as ProjectionLike | undefined;
        const explorerView = app.workspace.getLeavesOfType('file-explorer')[0]?.view as ExplorerViewLike | undefined;
        return {
          ...disableMs !== undefined && { disableMs: Math.round(disableMs) },
          error: null,
          explorerFolderItems: Object.keys(explorerView?.fileItems ?? {}).filter((path) => path.startsWith(folderPrefix)).length,
          fastEnableApplied: projection?.fastEnableApplied ?? false,
          folderFilesLoaded: countFolderFiles(),
          heapAfterMb: Math.round(getHeapMb()),
          heapBeforeMb: Math.round(heapBeforeMb),
          loadedFiles: app.vault.getAllLoadedFiles().length,
          longTaskCount: longTasks.length,
          longTaskMaxMs: Math.round(Math.max(0, ...longTasks)),
          longTaskTotalMs: Math.round(longTasks.reduce((sum, value) => sum + value, 0)),
          step: currentStep,
          wallMs: Math.round(wallMs)
        };

        async function setIgnoreContent(ignorePatterns: string): Promise<void> {
          await settingsComponent?.editAndSave((settings) => {
            settings.ignorePatterns = ignorePatterns;
          });
          await ignoreComponent?.processConfigChanges();
        }
      } catch (error) {
        return { error: String(error), step: currentStep };
      } finally {
        observer.disconnect();
      }

      function countFolderFiles(): number {
        return app.vault.getAllLoadedFiles().filter((file) => file.path.startsWith(folderPrefix)).length;
      }

      // Empties rather than deletes: a delete stays blocked while the document before a reload
      // still holds a connection.
      async function emptyDatabase(name: string): Promise<void> {
        const databases = await window.indexedDB.databases();
        if (databases.every((info) => info.name !== name)) {
          return;
        }
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = window.indexedDB.open(name);
          request.addEventListener('success', () => {
            resolve(request.result);
          });
          request.addEventListener('error', () => {
            reject(request.error ?? new Error(`Could not open ${name}`));
          });
        });
        try {
          const storeNames = [...database.objectStoreNames];
          if (storeNames.length === 0) {
            return;
          }
          const transaction = database.transaction(storeNames, 'readwrite');
          for (const storeName of storeNames) {
            transaction.objectStore(storeName).clear();
          }
          await new Promise<void>((resolve, reject) => {
            transaction.addEventListener('complete', () => {
              resolve();
            });
            transaction.addEventListener('error', () => {
              reject(transaction.error ?? new Error(`Could not empty ${name}`));
            });
          });
        } finally {
          database.close();
        }
      }

      async function disableTimed(): Promise<void> {
        const disableStart = performance.now();
        await app.plugins.disablePlugin(pluginId);
        disableMs = performance.now() - disableStart;
      }

      async function enableAndWait(): Promise<void> {
        await app.plugins.enablePlugin(pluginId);
        await waitFor(() => {
          const enabledPlugin = app.plugins.getPlugin(pluginId);
          const projection = enabledPlugin && findComponent(enabledPlugin, 'IndexProjectionComponent') as ProjectionLike | undefined;
          return projection ? projection.applyingProjectionDepth === 0 && (projection.fastEnableApplied || (projection.hasBuiltModel && projection.updateAbortController === null)) : false;
        });
      }

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

      function getHeapMb(): number {
        return ((performance as PerformanceWithMemory).memory?.usedJSHeapSize ?? 0) / bytesPerMb;
      }

      async function waitFor(isDone: () => boolean): Promise<void> {
        const deadline = performance.now() + doneTimeoutInMs;
        while (!isDone()) {
          if (performance.now() > deadline) {
            throw new Error(`${currentStep} did not finish`);
          }
          // Coarse on purpose: the predicates walk the whole loaded vault, and a tight poll was a
          // third of the measured cross-session re-show.
          await sleep(pollInMs);
        }
      }
    },
    input: { excludeMode, folder: SCENARIO_FOLDER, PLUGIN_ID, step },
    vaultPath
  });
}

async function runSteps(steps: readonly Step[], excludeMode: ExcludeMode): Promise<void> {
  const vaultPath = getTemporaryVault().path;
  const vaultSize = await settle(vaultPath);
  expect(vaultSize, 'the vault was populated and indexed').toBeGreaterThan(1000);

  for (const step of steps) {
    const result = await runStep(vaultPath, step, excludeMode);
    // Every message carries the step's whole measurement, so a failure reports the numbers.
    const measured = JSON.stringify(result);
    expect(result.error, measured).toBeNull();
    // Soft, so one slow step still lets every later step report its numbers.
    expect.soft(result.wallMs, `${step} wall time: ${measured}`).toBeLessThan(vaultSize * getMaxMsPerPath(step));
    const maxLongTaskInMs = step === 'restart' ? MAX_RESTART_STALL_IN_MS : MAX_LONG_TASK_IN_MS;
    expect.soft(result.longTaskMaxMs, `${step} longest main-thread task: ${measured}`).toBeLessThan(maxLongTaskInMs);
    if (step === 'coldEnable' || step === 'warmReEnable') {
      // A re-enable must leave the vault as it found it: nothing is ignored at this point.
      expect(result.loadedFiles, `${step} kept the vault indexed: ${measured}`).toBe(vaultSize);
    }
    if (step === 'warmReEnable' && excludeMode === ExcludeMode.Full) {
      expect(result.fastEnableApplied, `${step} took the fast path: ${measured}`).toBe(true);
    }
    // `Full` mode removes the folder from the index; `FilesPane` mode only from the explorer.
    const folderVisible = excludeMode === ExcludeMode.Full ? result.folderFilesLoaded : result.explorerFolderItems;
    if (step === 'hide' || step === 'restart') {
      expect(folderVisible, `${step} hid the folder: ${measured}`).toBe(0);
    } else if (step === 'showSameSession' || step === 'showCrossSession') {
      expect(folderVisible, `${step} re-showed the folder: ${measured}`).toBeGreaterThan(0);
    }
  }
}

async function settle(vaultPath: string): Promise<number> {
  // Wait out Obsidian's startup scan across short eval calls until the loaded-file count and the
  // metadata queue are stable.
  let previous = -1;
  for (let poll = 0; poll < SETTLE_MAX_POLLS; poll++) {
    const count = await evalInObsidian({
      async callback({ app, pollMs }): Promise<number> {
        await sleep(pollMs);
        return app.metadataCache.inProgressTaskCount > 0 ? -1 : app.vault.getAllLoadedFiles().length;
      },
      input: { pollMs: SETTLE_POLL_IN_MS },
      vaultPath
    });
    if (count !== -1 && count === previous) {
      return count;
    }
    previous = count;
  }
  return previous;
}
