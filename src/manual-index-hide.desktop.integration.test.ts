import type {
  MetadataCache,
  TAbstractFile,
  TFolder
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

interface ConsumerProbe {
  hasCache: boolean;
  inFileMap: boolean;
  inGetFiles: boolean;
}

type FileCacheValue = MetadataCache['fileCache'][string];
type LinkMap = MetadataCache['resolvedLinks'][string];

interface Snapshot {
  folder: ConsumerProbe;
  folderA: ConsumerProbe;
  keep: ConsumerProbe;
  linkerResolves: boolean;
  linkerUnresolved: boolean;
  target: ConsumerProbe;
}

/*
 * Prototype validation for the "direct index mutation" hide strategy (S6 in
 * `docs/working-with-other-plugins.md`): hide a file by mutating the vault/metadataCache
 * internals directly and firing NO events, then restore it from a snapshot. This proves the
 * mechanism removes a file from every consumer and brings it back, without the per-file
 * `reconcileDeletion` cascade that drives the bulk-hide freeze and the Obsidian Sync hazard.
 *
 * The hide/show logic is implemented inline here (serialized into Obsidian); when wired into
 * `IndexProjectionComponent` it becomes a shared module. This test only validates the
 * index-level mechanism; the file-explorer DOM is already handled by `FileTreeComponent`.
 */

const SETTLE_DELAY_IN_MS = 4000;

const LINKER = 's6-linker.md';
const TARGET = 's6-target.md';
const FOLDER = 's6-folder';
const FOLDER_A = 's6-folder/a.md';
const FOLDER_B = 's6-folder/b.md';
const KEEP = 's6-keep.md';

const ALL_TEST_FILES = [LINKER, TARGET, FOLDER_A, FOLDER_B, KEEP];
const ALL_TEST_FOLDERS = [FOLDER];

afterEach(async () => {
  await evalInObsidian({
    args: { ALL_TEST_FILES, ALL_TEST_FOLDERS },
    async fn({ ALL_TEST_FILES: files, ALL_TEST_FOLDERS: folders, app }) {
      for (const path of files) {
        const file = app.vault.getAbstractFileByPath(path);
        if (file) {
          // eslint-disable-next-line obsidianmd/prefer-file-manager-trash-file -- Test cleanup.
          await app.vault.delete(file, true);
        }
        try {
          await app.vault.adapter.remove(path);
        } catch {
          // Ignore.
        }
      }
      for (const folder of folders) {
        try {
          await app.vault.adapter.rmdir(folder, true);
        } catch {
          // Ignore.
        }
      }
    },
    vaultPath: getTempVault().path
  });
});

describe('Direct index mutation (S6) — hide/show without events', () => {
  it('removes a file, a folder, and demotes inbound links — then restores all, firing no events', async () => {
    const result = await evalInObsidian({
      args: { FOLDER, FOLDER_A, FOLDER_B, KEEP, LINKER, SETTLE_DELAY_IN_MS, TARGET },
      async fn({
        app,
        FOLDER: folderPath,
        FOLDER_A: folderA,
        FOLDER_B: folderB,
        KEEP: keepPath,
        LINKER: linkerPath,
        obsidianModule,
        SETTLE_DELAY_IN_MS: settleDelay,
        TARGET: targetPath
      }) {
        const { metadataCache: mc, vault } = app;
        const { TFile, TFolder: TFolderClass } = obsidianModule;

        interface RemovedEntry {
          fileCache?: FileCacheValue;
          isFile: boolean;
          node: TAbstractFile;
          parent: null | TFolder;
          path: string;
          resolved?: LinkMap;
          unresolved?: LinkMap;
        }

        interface Demotion {
          count: number;
          source: string;
          target: string;
        }

        interface HideResult {
          readonly demotions: Demotion[];
          readonly removed: RemovedEntry[];
        }

        await vault.createFolder(folderPath);
        await vault.create(targetPath, '# Target');
        await vault.create(linkerPath, `[[${targetPath.replace('.md', '')}]]`);
        await vault.create(folderA, 'a');
        await vault.create(folderB, 'b');
        await vault.create(keepPath, 'keep');
        await sleep(settleDelay);

        function probe(path: string): ConsumerProbe {
          return {
            hasCache: !!mc.getCache(path),
            inFileMap: !!vault.getAbstractFileByPath(path),
            inGetFiles: vault.getFiles().some((f) => f.path === path)
          };
        }

        function linkerResolvesTarget(): boolean {
          return !!(mc.resolvedLinks[linkerPath]?.[targetPath]);
        }

        function linkerUnresolvedTarget(): boolean {
          return !!(mc.unresolvedLinks[linkerPath]?.[targetPath]);
        }

        function snapshot(): Snapshot {
          return {
            folder: probe(folderPath),
            folderA: probe(folderA),
            keep: probe(keepPath),
            linkerResolves: linkerResolvesTarget(),
            linkerUnresolved: linkerUnresolvedTarget(),
            target: probe(targetPath)
          };
        }

        function collectPaths(rootPath: string): string[] {
          const root = vault.getAbstractFileByPath(rootPath);
          const out: string[] = [];
          if (!root) {
            return out;
          }
          const stack = [root];
          while (stack.length > 0) {
            const node = stack.pop();
            if (!node) {
              continue;
            }
            out.push(node.path);
            if (node instanceof TFolderClass) {
              for (const child of node.children) {
                stack.push(child);
              }
            }
          }
          return out;
        }

        function performHide(hidePaths: string[]): HideResult {
          const removed: RemovedEntry[] = [];
          for (const path of hidePaths) {
            const node = vault.getAbstractFileByPath(path);
            if (!node) {
              continue;
            }
            const isFile = node instanceof TFile;
            const entry: RemovedEntry = { isFile, node, parent: node.parent, path };
            if (isFile) {
              const cachedFileCache = mc.fileCache[path];
              const cachedResolved = mc.resolvedLinks[path];
              const cachedUnresolved = mc.unresolvedLinks[path];
              if (cachedFileCache) {
                entry.fileCache = cachedFileCache;
              }
              if (cachedResolved) {
                entry.resolved = cachedResolved;
              }
              if (cachedUnresolved) {
                entry.unresolved = cachedUnresolved;
              }
              // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- drop the file from Obsidian's internal cache maps (the hide).
              delete mc.fileCache[path];
              // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- drop the file from Obsidian's internal cache maps (the hide).
              delete mc.resolvedLinks[path];
              // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- drop the file from Obsidian's internal cache maps (the hide).
              delete mc.unresolvedLinks[path];
            }
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- remove the path from the vault file map (the hide).
            delete vault.fileMap[path];
            const parent = entry.parent;
            if (parent) {
              const index = parent.children.indexOf(node);
              if (index >= 0) {
                parent.children.splice(index, 1);
              }
            }
            removed.push(entry);
          }

          // Inbound-link demote — one batched pass (move hidden targets to unresolved).
          const hiddenFilePaths = new Set(removed.filter((entry) => entry.isFile).map((entry) => entry.path));
          const demotions: Demotion[] = [];
          for (const source of Object.keys(mc.resolvedLinks)) {
            const links = mc.resolvedLinks[source];
            if (!links) {
              continue;
            }
            for (const target of Object.keys(links)) {
              if (!hiddenFilePaths.has(target)) {
                continue;
              }
              const count = links[target] ?? 0;
              demotions.push({ count, source, target });
              mc.unresolvedLinks[source] ??= {};
              const unresolvedForSource = mc.unresolvedLinks[source];
              unresolvedForSource[target] = count;
              // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- demote: drop the resolved link to the now-hidden target.
              delete links[target];
            }
          }
          return { demotions, removed };
        }

        function performShow({ demotions, removed }: HideResult): void {
          for (const entry of removed) {
            vault.fileMap[entry.path] = entry.node;
            const parent = entry.parent;
            if (parent && !parent.children.includes(entry.node)) {
              parent.children.push(entry.node);
            }
            if (entry.isFile) {
              if (entry.fileCache) {
                mc.fileCache[entry.path] = entry.fileCache;
              }
              if (entry.resolved) {
                mc.resolvedLinks[entry.path] = entry.resolved;
              }
              if (entry.unresolved) {
                mc.unresolvedLinks[entry.path] = entry.unresolved;
              }
            }
          }
          for (const demotion of demotions) {
            const { source } = demotion;
            mc.resolvedLinks[source] ??= {};
            const resolvedForSource = mc.resolvedLinks[source];
            resolvedForSource[demotion.target] = demotion.count;
            const unresolvedForSource = mc.unresolvedLinks[source];
            if (unresolvedForSource) {
              // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- restore: clear the temporary unresolved entry.
              delete unresolvedForSource[demotion.target];
            }
          }
        }

        const before = snapshot();

        // Spy event dispatch so we can assert the hide/show fire nothing.
        let vaultTriggers = 0;
        let mcTriggers = 0;
        const originalVaultTrigger = vault.trigger.bind(vault);
        const originalMcTrigger = mc.trigger.bind(mc);
        vault.trigger = (name: string, ...data: unknown[]): void => {
          vaultTriggers++;
          originalVaultTrigger(name, ...data);
        };
        mc.trigger = (name: string, ...data: unknown[]): void => {
          mcTriggers++;
          originalMcTrigger(name, ...data);
        };

        const hideResult = performHide([targetPath, ...collectPaths(folderPath)]);
        const hideTriggers = { mc: mcTriggers, vault: vaultTriggers };
        const afterHide = snapshot();

        vaultTriggers = 0;
        mcTriggers = 0;
        performShow(hideResult);
        const showTriggers = { mc: mcTriggers, vault: vaultTriggers };
        const afterShow = snapshot();

        vault.trigger = originalVaultTrigger;
        mc.trigger = originalMcTrigger;

        return { afterHide, afterShow, before, hideTriggers, showTriggers };
      },
      vaultPath: getTempVault().path
    });

    // Preconditions: everything present, linker resolves the target.
    expect(result.before.target).toEqual({ hasCache: true, inFileMap: true, inGetFiles: true });
    expect(result.before.folderA).toEqual({ hasCache: true, inFileMap: true, inGetFiles: true });
    expect(result.before.linkerResolves).toBe(true);
    expect(result.before.linkerUnresolved).toBe(false);

    // After hide: target + folder (and its files) gone from every consumer; keep untouched.
    expect(result.afterHide.target).toEqual({ hasCache: false, inFileMap: false, inGetFiles: false });
    expect(result.afterHide.folder.inFileMap).toBe(false);
    expect(result.afterHide.folderA).toEqual({ hasCache: false, inFileMap: false, inGetFiles: false });
    expect(result.afterHide.keep).toEqual({ hasCache: true, inFileMap: true, inGetFiles: true });

    // Inbound link to the hidden target was demoted from resolved to unresolved.
    expect(result.afterHide.linkerResolves).toBe(false);
    expect(result.afterHide.linkerUnresolved).toBe(true);

    // The hide fired no vault/metadataCache events.
    expect(result.hideTriggers).toEqual({ mc: 0, vault: 0 });

    // After show: everything restored, linker resolves again.
    expect(result.afterShow.target).toEqual({ hasCache: true, inFileMap: true, inGetFiles: true });
    expect(result.afterShow.folderA).toEqual({ hasCache: true, inFileMap: true, inGetFiles: true });
    expect(result.afterShow.linkerResolves).toBe(true);
    expect(result.afterShow.linkerUnresolved).toBe(false);

    // The show also fired no events.
    expect(result.showTriggers).toEqual({ mc: 0, vault: 0 });
  });
});
