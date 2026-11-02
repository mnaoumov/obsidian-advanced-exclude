import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  expect,
  it
} from 'vitest';

import type { ManualIndexHider } from './manual-index-hider.ts';

interface ProjectionChild {
  readonly _children?: readonly ProjectionChild[];
  readonly manualIndexHider?: ManualIndexHider;
}

/*
 * A note hidden while Obsidian is still parsing it: the parse finishes after the hide, writes the
 * note's cache entry back and queues it for link resolution. Before the fix `resolveLinks` threw on
 * the missing file, and Obsidian's link resolver loop stopped for the rest of the session, so no
 * link anywhere in the vault resolved again until a reload.
 */
it('keeps resolving links after hiding notes whose parse is still in flight', async () => {
  const result = await evalInObsidian({
    async callback({ app, lib: { waitUntil } }) {
      function findHider(children: readonly ProjectionChild[]): ManualIndexHider | undefined {
        for (const child of children) {
          const found = child.manualIndexHider ?? findHider(child._children ?? []);
          if (found) {
            return found;
          }
        }
        return undefined;
      }
      const plugin = app.plugins.getPlugin('advanced-exclude') as null | ProjectionChild;
      const hider = findHider(plugin?._children ?? []);
      if (!hider) {
        throw new Error('Plugin projection missing');
      }

      const paths = Array.from({ length: 20 }, (_, index) => `parse-race/note-${String(index)}.md`);
      await app.vault.createFolder('parse-race');
      await Promise.all(paths.map((path) => app.vault.create(path, `# ${path}`)));
      // A parse in flight has saved the placeholder entry, with no hash yet.
      const inFlightAtHide = paths.filter((path) => app.metadataCache.fileCache[path]?.hash === '').length;
      hider.hide(paths);
      try {
        await waitUntil({ message: 'parse queue drained', predicate: () => app.metadataCache.inProgressTaskCount === 0 });
        const cachedWhileHidden = paths.filter((path) => app.metadataCache.fileCache[path] !== undefined).length;

        await app.vault.create('parse-race-target.md', '# Target');
        await app.vault.create('parse-race-source.md', '[[parse-race-target]]');
        let isLinkResolved = true;
        try {
          await waitUntil({ message: 'link resolved', predicate: () => Boolean(app.metadataCache.resolvedLinks['parse-race-source.md']?.['parse-race-target.md']) });
        } catch {
          isLinkResolved = false;
        }
        return { cachedWhileHidden, inFlightAtHide, isLinkResolved };
      } finally {
        hider.show(paths);
        for (const path of ['parse-race-source.md', 'parse-race-target.md', 'parse-race']) {
          const file = app.vault.getAbstractFileByPath(path);
          if (file) {
            await app.fileManager.trashFile(file);
          }
        }
      }
    },
    vaultPath: getTemporaryVault().path
  });

  expect(result.inFlightAtHide).toBeGreaterThan(0);
  expect(result).toMatchObject({ cachedWhileHidden: 0, isLinkResolved: true });
});
