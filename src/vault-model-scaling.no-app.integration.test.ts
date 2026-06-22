import {
  describe,
  expect,
  it
} from 'vitest';

import type { VaultModelEntry } from './vault-model.ts';

import { VaultModel } from './vault-model.ts';

/*
 * Pure in-memory scaling of the shadow tree — no Obsidian, no disk — so it can go
 * far past what real-vault integration can create and index. This is where the
 * maintainer's real vault size (F:\Obsidian, ~90,000 paths) is actually exercised:
 * generating 90k real files end to end times out, but the model handles it (and
 * 1,000,000) in well under a second. The point is the hide cost: a single ignored
 * folder always collapses to one hide-root, and N independently-ignored folders
 * yield exactly N, whatever the file count. The 30 s project timeout doubles as an
 * O(N^2) guard.
 */

const SINGLE_FOLDER_SIZES = [90_000, 1_000_000];
const MANY_FOLDER_COUNTS = [10_000, 100_000];
const IGNORED_FOLDER = 'big';

describe('VaultModel scaling — single ignored folder', () => {
  for (const size of SINGLE_FOLDER_SIZES) {
    it(`collapses a ${size.toLocaleString()}-file ignored folder to one hide-root`, async () => {
      const model = new VaultModel((path) => path === IGNORED_FOLDER || path.startsWith(`${IGNORED_FOLDER}/`));
      const entries: VaultModelEntry[] = [{ isFolder: true, path: IGNORED_FOLDER }];
      for (let index = 0; index < size; index++) {
        entries.push({ isFolder: false, path: `${IGNORED_FOLDER}/file-${String(index)}.md` });
      }
      entries.push({ isFolder: false, path: 'keep.md' });

      await model.rebuild(entries);

      const hideRoots = model.getHideRoots();
      expect(hideRoots).toHaveLength(1);
      expect(hideRoots[0]?.path).toBe(IGNORED_FOLDER);
      // Every file inside the folder is hidden; the sibling stays visible.
      expect(model.isVisible(`${IGNORED_FOLDER}/file-0.md`)).toBe(false);
      expect(model.isVisible(`${IGNORED_FOLDER}/file-${String(size - 1)}.md`)).toBe(false);
      expect(model.isVisible('keep.md')).toBe(true);
    });
  }
});

describe('VaultModel scaling — many independently-ignored folders', () => {
  for (const count of MANY_FOLDER_COUNTS) {
    it(`yields exactly one hide-root per folder for ${count.toLocaleString()} folders`, async () => {
      const ignoredFolder = /^dir-\d+(?:\/|$)/;
      const model = new VaultModel((path) => ignoredFolder.test(path));
      const entries: VaultModelEntry[] = [];
      for (let index = 0; index < count; index++) {
        entries.push({ isFolder: true, path: `dir-${String(index)}` });
        entries.push({ isFolder: false, path: `dir-${String(index)}/file.md` });
      }

      await model.rebuild(entries);

      // Each top-level folder is its own hide-root: cost is O(folders), not O(files).
      expect(model.getHideRoots()).toHaveLength(count);
    });
  }
});
