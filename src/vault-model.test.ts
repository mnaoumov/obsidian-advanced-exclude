import ignore from 'ignore';
import { noopAsync } from 'obsidian-dev-utils/function';
import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  IsIgnoredFn,
  VaultModelEntry
} from './vault-model.ts';

import { VaultModel } from './vault-model.ts';

describe('VaultModel', () => {
  describe('visibility', () => {
    it('hides ignored files and keeps the rest', () => {
      const model = build(
        [
          { isFolder: false, path: 'a.md' },
          { isFolder: false, path: 'b.md' }
        ],
        matcher(['a.md'])
      );

      expect(model.isVisible('a.md')).toBe(false);
      expect(model.isVisible('b.md')).toBe(true);
      expect(nodeCount(model)).toBe(3); // Root + two files
    });

    it('keeps a folder that tests ignored but has a re-included descendant (negation case D)', () => {
      const model = build(
        [
          { isFolder: true, path: 'foo' },
          { isFolder: true, path: 'foo/bar' },
          { isFolder: true, path: 'foo/bar/baz' },
          { isFolder: false, path: 'foo/bar/baz/deep.md' },
          { isFolder: false, path: 'foo/bar/other.md' },
          { isFolder: false, path: 'foo/bar/qux.md' }
        ],
        matcher(['foo/bar/*', '!foo/bar/baz/', '!foo/bar/baz/deep.md'])
      );

      // Baz tests ignored, but must stay visible so deep.md is reachable.
      expect(model.isVisible('foo/bar/baz/deep.md')).toBe(true);
      expect(model.isVisible('foo/bar/baz')).toBe(true);
      expect(model.isVisible('foo/bar')).toBe(true);
      expect(model.isVisible('foo')).toBe(true);
      expect(model.isVisible('foo/bar/other.md')).toBe(false);
      expect(model.isVisible('foo/bar/qux.md')).toBe(false);
    });

    it('treats a negation under a fully-excluded directory as a no-op (case A)', () => {
      const model = build(
        [
          { isFolder: true, path: 'foo' },
          { isFolder: true, path: 'foo/bar' },
          { isFolder: true, path: 'foo/bar/baz' },
          { isFolder: false, path: 'foo/bar/baz/deep.md' },
          { isFolder: false, path: 'foo/bar/qux.md' }
        ],
        matcher(['foo/bar', '!foo/bar/baz'])
      );

      expect(model.isVisible('foo')).toBe(true);
      expect(model.isVisible('foo/bar')).toBe(false);
      expect(model.isVisible('foo/bar/baz')).toBe(false);
      expect(model.isVisible('foo/bar/baz/deep.md')).toBe(false);
      expect(model.isVisible('foo/bar/qux.md')).toBe(false);
    });

    it('re-includes a descendant when the directory contents are ignored (case B)', () => {
      const model = build(
        [
          { isFolder: true, path: 'foo' },
          { isFolder: true, path: 'foo/bar' },
          { isFolder: true, path: 'foo/bar/baz' },
          { isFolder: false, path: 'foo/bar/baz/keep.md' },
          { isFolder: false, path: 'foo/bar/qux.md' }
        ],
        matcher(['foo/bar/*', '!foo/bar/baz'])
      );

      expect(model.isVisible('foo/bar')).toBe(true);
      expect(model.isVisible('foo/bar/baz')).toBe(true);
      expect(model.isVisible('foo/bar/baz/keep.md')).toBe(true);
      expect(model.isVisible('foo/bar/qux.md')).toBe(false);
    });

    it('keeps a non-ignored empty folder visible', () => {
      const model = build([{ isFolder: true, path: 'empty' }], matcher([]));
      expect(model.isVisible('empty')).toBe(true);
    });
  });

  describe('ancestor propagation', () => {
    it('hides the folder chain only when the last visible child is hidden', () => {
      // The folders are themselves ignored, so each is visible only while it holds a visible descendant.
      const ignored = new Set<string>(['a', 'a/b']);
      const model = build(
        [
          { isFolder: true, path: 'a' },
          { isFolder: true, path: 'a/b' },
          { isFolder: false, path: 'a/b/x.md' },
          { isFolder: false, path: 'a/b/y.md' }
        ],
        (path) => ignored.has(path)
      );

      // Hide one of two children: folders stay visible, only the file flips.
      ignored.add('a/b/x.md');
      let changes = model.recomputeFrom('a/b/x.md');
      expect(changes).toEqual([{ isFolder: false, isVisible: false, path: 'a/b/x.md' }]);
      expect(model.isVisible('a/b')).toBe(true);
      expect(model.isVisible('a')).toBe(true);

      // Hide the last visible child: flip propagates up a -> a/b -> a, stops at root.
      ignored.add('a/b/y.md');
      changes = model.recomputeFrom('a/b/y.md');
      expect(changes).toEqual([
        { isFolder: false, isVisible: false, path: 'a/b/y.md' },
        { isFolder: true, isVisible: false, path: 'a/b' },
        { isFolder: true, isVisible: false, path: 'a' }
      ]);

      // Restore one child: flip propagates back up.
      ignored.delete('a/b/x.md');
      changes = model.recomputeFrom('a/b/x.md');
      expect(changes).toEqual([
        { isFolder: false, isVisible: true, path: 'a/b/x.md' },
        { isFolder: true, isVisible: true, path: 'a/b' },
        { isFolder: true, isVisible: true, path: 'a' }
      ]);
    });

    it('returns no changes when a recompute does not flip the node', () => {
      const model = build([{ isFolder: false, path: 'a.md' }], matcher([]));
      expect(model.recomputeFrom('a.md')).toEqual([]);
    });

    it('returns nothing for an unknown path', () => {
      const model = build([], matcher([]));
      expect(model.recomputeFrom('missing.md')).toEqual([]);
    });
  });

  describe('setPath', () => {
    it('creates missing ancestors and makes a hidden folder visible when a visible file appears', () => {
      const ignored = new Set<string>(['a', 'a/b']);
      const model = build([{ isFolder: true, path: 'a' }, { isFolder: true, path: 'a/b' }], (path) => ignored.has(path));

      expect(model.isVisible('a/b')).toBe(false);

      const changes = model.setPath('a/b/new.md', false);
      expect(model.isVisible('a/b/new.md')).not.toBeUndefined();
      expect(changes).toEqual([
        { isFolder: false, isVisible: true, path: 'a/b/new.md' },
        { isFolder: true, isVisible: true, path: 'a/b' },
        { isFolder: true, isVisible: true, path: 'a' }
      ]);
    });
  });

  describe('deletePath', () => {
    it('removes the subtree and flips an emptied folder hidden', () => {
      const ignored = new Set<string>(['a', 'a/b']);
      const model = build(
        [
          { isFolder: true, path: 'a' },
          { isFolder: true, path: 'a/b' },
          { isFolder: false, path: 'a/b/only.md' }
        ],
        (path) => ignored.has(path)
      );

      expect(model.isVisible('a/b')).toBe(true);

      const changes = model.deletePath('a/b/only.md');
      expect(model.isVisible('a/b/only.md')).toBeUndefined();
      expect(changes).toEqual([
        { isFolder: true, isVisible: false, path: 'a/b' },
        { isFolder: true, isVisible: false, path: 'a' }
      ]);
    });

    it('removes descendants when a folder is deleted', () => {
      const model = build(
        [
          { isFolder: true, path: 'a' },
          { isFolder: false, path: 'a/x.md' },
          { isFolder: false, path: 'a/y.md' }
        ],
        matcher([])
      );

      model.deletePath('a');
      expect(model.isVisible('a')).toBeUndefined();
      expect(model.isVisible('a/x.md')).toBeUndefined();
      expect(model.isVisible('a/y.md')).toBeUndefined();
    });

    it('ignores deletion of an unknown path', () => {
      const model = build([], matcher([]));
      expect(model.deletePath('missing.md')).toEqual([]);
    });
  });

  describe('getHideRoots', () => {
    it('returns only the topmost hidden node of a fully-ignored subtree', () => {
      const model = build(
        [
          { isFolder: true, path: 'a' },
          { isFolder: false, path: 'a/x.md' },
          { isFolder: false, path: 'a/y.md' }
        ],
        matcher(['a'])
      );

      expect(model.getHideRoots()).toEqual([{ isFolder: true, path: 'a' }]);
    });

    it('returns the individually-hidden children of a visible folder', () => {
      const model = build(
        [
          { isFolder: true, path: 'a' },
          { isFolder: false, path: 'a/keep.md' },
          { isFolder: false, path: 'a/drop.md' }
        ],
        matcher(['a/drop.md'])
      );

      expect(model.getHideRoots()).toEqual([{ isFolder: false, path: 'a/drop.md' }]);
    });

    it('returns the ignored folder, not its descendants, under a visible parent (case A)', () => {
      const model = build(
        [
          { isFolder: true, path: 'foo' },
          { isFolder: true, path: 'foo/bar' },
          { isFolder: false, path: 'foo/bar/qux.md' }
        ],
        matcher(['foo/bar', '!foo/bar/baz'])
      );

      expect(model.getHideRoots()).toEqual([{ isFolder: true, path: 'foo/bar' }]);
    });
  });

  describe('isParentVisible', () => {
    it('returns true for a child of a visible folder', () => {
      const model = build(
        [
          { isFolder: true, path: 'a' },
          { isFolder: false, path: 'a/drop.md' }
        ],
        matcher(['a/drop.md'])
      );

      expect(model.isParentVisible('a/drop.md')).toBe(true);
    });

    it('returns false for a descendant of a hidden folder', () => {
      const model = build(
        [
          { isFolder: true, path: 'a' },
          { isFolder: false, path: 'a/x.md' }
        ],
        matcher(['a'])
      );

      expect(model.isParentVisible('a/x.md')).toBe(false);
    });

    it('returns true for a top-level node (parent is the always-visible root)', () => {
      const model = build([{ isFolder: false, path: 'drop.md' }], matcher(['drop.md']));

      expect(model.isParentVisible('drop.md')).toBe(true);
    });

    it('returns undefined for an unknown path', () => {
      const model = build([{ isFolder: false, path: 'a.md' }], matcher([]));

      expect(model.isParentVisible('nope.md')).toBeUndefined();
    });

    it('treats the root (which has no parent) as visible', () => {
      const model = build([{ isFolder: false, path: 'a.md' }], matcher([]));

      expect(model.isParentVisible('/')).toBe(true);
    });
  });

  describe('getPathsByVisibility', () => {
    it('returns hidden and visible sets excluding the root', () => {
      const model = build(
        [
          { isFolder: false, path: 'keep.md' },
          { isFolder: false, path: 'drop.md' }
        ],
        matcher(['drop.md'])
      );

      expect(model.getPathsByVisibility(false)).toEqual([{ isFolder: false, path: 'drop.md' }]);
      expect(model.getPathsByVisibility(true)).toEqual([{ isFolder: false, path: 'keep.md' }]);
    });
  });

  describe('recomputeAll', () => {
    it('returns the visibility flips deepest-first', async () => {
      const ignored = new Set<string>();
      const model = build(
        [
          { isFolder: true, path: 'a' },
          { isFolder: false, path: 'a/x.md' }
        ],
        (path) => ignored.has(path)
      );

      ignored.add('a');
      ignored.add('a/x.md');
      const changes = await model.recomputeAll();

      expect(changes).toEqual([
        { isFolder: false, isVisible: false, path: 'a/x.md' },
        { isFolder: true, isVisible: false, path: 'a' }
      ]);
    });

    it('yields and reports progress when a yieldFn is supplied for a large model', async () => {
      // A model larger than the yield chunk so a chunk boundary is reached.
      const model = build(largeFolderEntries(6000), () => false);

      const progress: number[][] = [];
      let yieldCount = 0;
      await model.recomputeAll({
        onProgress: (processed, total) => {
          progress.push([processed, total]);
        },
        yieldFn: async () => {
          yieldCount++;
          await noopAsync();
        }
      });

      expect(yieldCount).toBeGreaterThan(0);
      expect(progress.length).toBeGreaterThan(0);
      // The final report covers the whole tree (two visits per node).
      expect(progress.at(-1)).toEqual([nodeCount(model) * 2, nodeCount(model) * 2]);
    });

    it('stops early when aborted during the ignore-evaluation pass', async () => {
      let isIgnoredNow = false;
      const model = build(largeFolderEntries(6000), () => isIgnoredNow);
      isIgnoredNow = true;
      const controller = new AbortController();

      const changes = await model.recomputeAll({
        abortSignal: controller.signal,
        yieldFn: async () => {
          controller.abort();
          await noopAsync();
        }
      });

      // Aborted on the first chunk boundary (the ignore-evaluation pass, before any
      // Visibility flip is collected), so it returns no changes.
      expect(changes).toEqual([]);
    });

    it('stops early when aborted during the visibility pass, keeping flips collected so far', async () => {
      let isIgnoredNow = false;
      const model = build(largeFolderEntries(6000), () => isIgnoredNow);
      isIgnoredNow = true;
      const controller = new AbortController();
      let yieldCount = 0;

      const changes = await model.recomputeAll({
        abortSignal: controller.signal,
        yieldFn: async () => {
          yieldCount++;
          // The second boundary falls in the visibility pass.
          if (yieldCount === 2) {
            controller.abort();
          }
          await noopAsync();
        }
      });

      expect(changes.length).toBeGreaterThan(0);
    });
  });

  describe('recomputeAll vs incremental', () => {
    it('agree after a sequence of single-path flips', async () => {
      const ignored = new Set<string>();
      const entries: VaultModelEntry[] = [
        { isFolder: true, path: 'a' },
        { isFolder: true, path: 'a/b' },
        { isFolder: false, path: 'a/b/x.md' },
        { isFolder: false, path: 'a/b/y.md' },
        { isFolder: false, path: 'a/z.md' }
      ];
      const incremental = new VaultModel(isIgnored);
      await incremental.rebuild(entries);

      for (const path of ['a/b/x.md', 'a/b/y.md', 'a/z.md']) {
        ignored.add(path);
        incremental.recomputeFrom(path);
      }

      const full = new VaultModel(isIgnored);
      await full.rebuild(entries);

      for (const entry of entries) {
        expect(incremental.isVisible(entry.path)).toBe(full.isVisible(entry.path));
      }

      function isIgnored(normalizedPath: string): boolean {
        return ignored.has(normalizedPath);
      }
    });
  });
});

function build(entries: readonly VaultModelEntry[], isIgnored: IsIgnoredFn): VaultModel {
  const model = new VaultModel(isIgnored);
  // Without a `yieldFn` the async recompute never suspends, so the model is fully
  // Built synchronously by the time `rebuild` returns its (already resolved) promise.
  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- settles synchronously without a yieldFn.
  model.rebuild(entries);
  return model;
}

function largeFolderEntries(count: number): VaultModelEntry[] {
  const entries: VaultModelEntry[] = [{ isFolder: true, path: 'big' }];
  for (let index = 0; index < count; index++) {
    entries.push({ isFolder: false, path: `big/file-${String(index)}.md` });
  }
  return entries;
}

function matcher(patterns: readonly string[]): IsIgnoredFn {
  const ig = ignore({ ignoreCase: true }).add([...patterns]);
  return (normalizedPath: string, isFolder: boolean): boolean => {
    const pathsToCheck = isFolder ? [normalizedPath, `${normalizedPath}/`] : [normalizedPath];
    return pathsToCheck.some((path) => ig.ignores(path));
  };
}

function nodeCount(model: VaultModel): number {
  // `getPathsByVisibility` reports every node except the root, so add the root back.
  return model.getPathsByVisibility(true).length + model.getPathsByVisibility(false).length + 1;
}
