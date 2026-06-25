import type {
  App,
  MetadataCache,
  TAbstractFile,
  Vault
} from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  TFile,
  TFolder
} from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { ManualIndexHider } from './manual-index-hider.ts';

interface Fixture {
  app: App;
  fileCache: MetadataCache['fileCache'];
  fileMap: Vault['fileMap'];
  resolvedLinks: MetadataCache['resolvedLinks'];
  unresolvedLinks: MetadataCache['unresolvedLinks'];
}

let fixture: Fixture;
let hider: ManualIndexHider;

beforeEach(() => {
  fixture = createFixture();
  hider = new ManualIndexHider(fixture.app);
});

describe('ManualIndexHider', () => {
  describe('hide', () => {
    it('removes a file from fileMap, fileCache, and its parent children', () => {
      hider.hide(['a.md']);

      expect(fixture.fileMap['a.md']).toBeUndefined();
      expect(fixture.fileCache['a.md']).toBeUndefined();
      expect(fixture.app.vault.getAbstractFileByPath('a.md')).toBeNull();
      expect(childrenPaths('/')).not.toContain('a.md');
      expect(hider.hasSnapshot('a.md')).toBe(true);
    });

    it('demotes inbound resolved links — creating the unresolved bucket when absent and reusing it when present', () => {
      hider.hide(['a.md']);

      // `linker.md` already had an unresolved bucket (reused); `linker2.md` had none (created).
      expect(fixture.resolvedLinks['linker.md']?.['a.md']).toBeUndefined();
      expect(fixture.resolvedLinks['linker2.md']?.['a.md']).toBeUndefined();
      expect(fixture.unresolvedLinks['linker.md']?.['a.md']).toBe(2);
      expect(fixture.unresolvedLinks['linker2.md']?.['a.md']).toBe(1);
    });

    it('removes a folder and its file', () => {
      hider.hide(['f', 'f/x.md']);

      expect(fixture.fileMap['f']).toBeUndefined();
      expect(fixture.fileMap['f/x.md']).toBeUndefined();
      expect(fixture.fileCache['f/x.md']).toBeUndefined();
      expect(hider.hasSnapshot('f')).toBe(true);
      expect(hider.hasSnapshot('f/x.md')).toBe(true);
    });

    it('removes a file with outgoing resolved and unresolved links', () => {
      hider.hide(['linker.md']);

      expect(fixture.fileMap['linker.md']).toBeUndefined();
      expect(fixture.resolvedLinks['linker.md']).toBeUndefined();
      expect(fixture.unresolvedLinks['linker.md']).toBeUndefined();
    });

    it('removes a file that has no cache entry and a null parent', () => {
      hider.hide(['orphan.md']);

      expect(fixture.fileMap['orphan.md']).toBeUndefined();
      expect(hider.hasSnapshot('orphan.md')).toBe(true);
    });

    it('removes a file whose parent does not list it among its children', () => {
      hider.hide(['f/ghost.md']);

      expect(fixture.fileMap['f/ghost.md']).toBeUndefined();
      expect(hider.hasSnapshot('f/ghost.md')).toBe(true);
    });

    it('skips a path that is not in the index', () => {
      hider.hide(['does-not-exist.md']);

      expect(hider.hasSnapshot('does-not-exist.md')).toBe(false);
    });

    it('leaves an unrelated file untouched', () => {
      hider.hide(['a.md']);

      expect(fixture.fileMap['keep.md']).toBeDefined();
      expect(fixture.fileCache['keep.md']).toBeDefined();
    });
  });

  describe('show', () => {
    it('restores a hidden file and its cache, and re-promotes inbound links', () => {
      hider.hide(['a.md']);
      const result = hider.show(['a.md']);

      expect(result).toEqual([]);
      expect(fixture.fileMap['a.md']).toBeDefined();
      expect(fixture.fileCache['a.md']).toEqual({ hash: 'a', mtime: 1, size: 1 });
      expect(fixture.resolvedLinks['linker.md']?.['a.md']).toBe(2);
      expect(fixture.unresolvedLinks['linker.md']?.['a.md']).toBeUndefined();
      expect(hider.hasSnapshot('a.md')).toBe(false);
      expect(childrenPaths('/')).toContain('a.md');
    });

    it('restores a file with outgoing resolved and unresolved links', () => {
      hider.hide(['linker.md']);
      hider.show(['linker.md']);

      expect(fixture.resolvedLinks['linker.md']?.['a.md']).toBe(2);
      expect(fixture.unresolvedLinks['linker.md']?.['missing.md']).toBe(1);
    });

    it('restores a hidden folder and its file', () => {
      hider.hide(['f', 'f/x.md']);
      const result = hider.show(['f', 'f/x.md']);

      expect(result).toEqual([]);
      expect(fixture.fileMap['f']).toBeDefined();
      expect(fixture.fileMap['f/x.md']).toBeDefined();
      expect(fixture.fileCache['f/x.md']).toEqual({ hash: 'x', mtime: 1, size: 1 });
    });

    it('restores a file with no cache and a null parent', () => {
      hider.hide(['orphan.md']);
      const result = hider.show(['orphan.md']);

      expect(result).toEqual([]);
      expect(fixture.fileMap['orphan.md']).toBeDefined();
      expect(fixture.fileCache['orphan.md']).toBeUndefined();
    });

    it('does not duplicate a file in its parent children on restore', () => {
      hider.hide(['a.md']);
      hider.show(['a.md']);

      expect(childrenPaths('/').filter((path) => path === 'a.md')).toHaveLength(1);
    });

    it('re-promotes an inbound link even when the source was hidden after the demotion (recreates its link maps)', () => {
      hider.hide(['a.md']); // Records the linker.md -> a.md demotion.
      hider.hide(['linker.md']); // Removes linker.md's own link maps.
      hider.show(['a.md']);

      // Promoting a.md recreates linker.md's resolved-links bucket from the recorded demotion.
      expect(fixture.resolvedLinks['linker.md']?.['a.md']).toBe(2);
      expect(fixture.unresolvedLinks['linker.md']).toBeUndefined();
    });

    it('returns paths that have no snapshot for the caller to re-parse', () => {
      const result = hider.show(['never-hidden.md']);

      expect(result).toEqual(['never-hidden.md']);
    });
  });

  describe('getSnapshotStat', () => {
    it('returns the mtime/size captured when the file was hidden', () => {
      const file = fixture.fileMap['a.md'];
      if (file instanceof TFile) {
        file.stat.mtime = 1700;
        file.stat.size = 42;
      }
      hider.hide(['a.md']);

      expect(hider.getSnapshotStat('a.md')).toEqual({ mtime: 1700, size: 42 });
    });

    it('returns null for a path that was never hidden', () => {
      expect(hider.getSnapshotStat('a.md')).toBeNull();
    });

    it('returns null for a hidden folder, which carries no stat', () => {
      hider.hide(['f']);

      expect(hider.getSnapshotStat('f')).toBeNull();
    });
  });

  describe('dropStaleSnapshot', () => {
    it('discards the snapshot and re-promotes inbound links, so a later show re-parses', () => {
      hider.hide(['a.md']);
      hider.dropStaleSnapshot('a.md');

      expect(hider.hasSnapshot('a.md')).toBe(false);
      // Inbound links are promoted back (the file is returning), but the cache is not restored.
      expect(fixture.resolvedLinks['linker.md']?.['a.md']).toBe(2);
      expect(fixture.unresolvedLinks['linker.md']?.['a.md']).toBeUndefined();
      expect(fixture.fileMap['a.md']).toBeUndefined();
      expect(hider.show(['a.md'])).toEqual(['a.md']);
    });

    it('is a no-op when no snapshot is held', () => {
      hider.dropStaleSnapshot('never-hidden.md');

      expect(hider.hasSnapshot('never-hidden.md')).toBe(false);
      expect(fixture.resolvedLinks['linker.md']?.['a.md']).toBe(2);
    });
  });
});

function childrenPaths(folderPath: string): string[] {
  const folder = fixture.fileMap[folderPath];
  return folder instanceof TFolder ? folder.children.map((child) => child.path) : [];
}

function createFixture(): Fixture {
  /*
   * The test-mocks Vault models `fileMap__`, not the real `fileMap` this module mutates, and a
   * strict proxy throws on the missing-key reads the module makes on Obsidian's record maps
   * (which return `undefined` in real Obsidian). So build a plain App with exactly the surface
   * the module touches and cast it — real `TFile`/`TFolder` instances keep `instanceof` working.
   */
  const dummyVault = castTo<Parameters<typeof TFile.create__>[0]>({});
  const root = TFolder.create__(dummyVault, '/');
  const fileA = TFile.create__(dummyVault, 'a.md');
  const linker = TFile.create__(dummyVault, 'linker.md');
  const linker2 = TFile.create__(dummyVault, 'linker2.md');
  const keep = TFile.create__(dummyVault, 'keep.md');
  const folderF = TFolder.create__(dummyVault, 'f');
  const fileX = TFile.create__(dummyVault, 'f/x.md');
  // An orphan file: present in the map but with no cache entry and a null parent.
  const orphan = TFile.create__(dummyVault, 'orphan.md');
  // A "ghost" file whose parent does not list it among its children (an inconsistent state).
  const ghost = TFile.create__(dummyVault, 'f/ghost.md');

  fileA.parent = root;
  linker.parent = root;
  linker2.parent = root;
  keep.parent = root;
  folderF.parent = root;
  fileX.parent = folderF;
  ghost.parent = folderF;
  root.children.push(fileA, linker, linker2, keep, folderF);
  folderF.children.push(fileX);

  const fileMap = castTo<Vault['fileMap']>({
    '/': root,
    'a.md': fileA,
    'f': folderF,
    'f/ghost.md': ghost,
    'f/x.md': fileX,
    'keep.md': keep,
    'linker.md': linker,
    'linker2.md': linker2,
    'orphan.md': orphan
  });
  const fileCache = castTo<MetadataCache['fileCache']>({
    'a.md': { hash: 'a', mtime: 1, size: 1 },
    'f/x.md': { hash: 'x', mtime: 1, size: 1 },
    'keep.md': { hash: 'k', mtime: 1, size: 1 },
    'linker.md': { hash: 'l', mtime: 1, size: 1 },
    'linker2.md': { hash: 'l2', mtime: 1, size: 1 }
  });
  const resolvedLinks = castTo<MetadataCache['resolvedLinks']>({
    // `keep.md` stays visible, so demotion must skip it while demoting `a.md`.
    'linker.md': { 'a.md': 2, 'keep.md': 1 },
    'linker2.md': { 'a.md': 1 }
  });
  const unresolvedLinks = castTo<MetadataCache['unresolvedLinks']>({
    'linker.md': { 'missing.md': 1 }
  });

  const vault = {
    fileMap,
    getAbstractFileByPath: (path: string): null | TAbstractFile => fileMap[path] ?? null
  };
  const metadataCache = { fileCache, resolvedLinks, unresolvedLinks };
  const app = castTo<App>({ metadataCache, vault });

  return { app, fileCache, fileMap, resolvedLinks, unresolvedLinks };
}
