import ignore from 'ignore';
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
      expect(model.size).toBe(3); // Root + two files
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
      expect(model.isKnown('a/b/new.md')).toBe(true);
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
      expect(model.isKnown('a/b/only.md')).toBe(false);
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
      expect(model.isKnown('a')).toBe(false);
      expect(model.isKnown('a/x.md')).toBe(false);
      expect(model.isKnown('a/y.md')).toBe(false);
    });

    it('ignores deletion of an unknown path', () => {
      const model = build([], matcher([]));
      expect(model.deletePath('missing.md')).toEqual([]);
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

  describe('recomputeAll vs incremental', () => {
    it('agree after a sequence of single-path flips', () => {
      const ignored = new Set<string>();
      const entries: VaultModelEntry[] = [
        { isFolder: true, path: 'a' },
        { isFolder: true, path: 'a/b' },
        { isFolder: false, path: 'a/b/x.md' },
        { isFolder: false, path: 'a/b/y.md' },
        { isFolder: false, path: 'a/z.md' }
      ];
      const incremental = new VaultModel(isIgnored);
      incremental.rebuild(entries);

      for (const path of ['a/b/x.md', 'a/b/y.md', 'a/z.md']) {
        ignored.add(path);
        incremental.recomputeFrom(path);
      }

      const full = new VaultModel(isIgnored);
      full.rebuild(entries);

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
  model.rebuild(entries);
  return model;
}

function matcher(patterns: readonly string[]): IsIgnoredFn {
  const ig = ignore({ ignoreCase: true }).add([...patterns]);
  return (normalizedPath: string, isFolder: boolean): boolean => {
    const pathsToCheck = isFolder ? [normalizedPath, `${normalizedPath}/`] : [normalizedPath];
    return pathsToCheck.some((path) => ig.ignores(path));
  };
}
