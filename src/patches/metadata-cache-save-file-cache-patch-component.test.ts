import type {
  App,
  MetadataCache
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ManualIndexHider } from '../index-projection/manual-index-hider.ts';

import { MetadataCacheSaveFileCachePatchComponent } from './metadata-cache-save-file-cache-patch-component.ts';

type FileCacheValue = MetadataCache['fileCache'][string];

interface Fixture {
  readonly captureFileCache: ReturnType<typeof vi.fn>;
  readonly component: MetadataCacheSaveFileCachePatchComponent;
  readonly originalSaveFileCache: ReturnType<typeof vi.fn>;
  readonly saveFileCache: (path: string, fileCache: FileCacheValue | null) => unknown;
}

const FILE_CACHE: FileCacheValue = { hash: 'h', mtime: 1, size: 1 };

function createFixture(isCaptured: boolean): Fixture {
  const originalSaveFileCache = vi.fn().mockReturnValue('saved');
  const metadataCache = castTo<Pick<Fixture, 'saveFileCache'>>({ saveFileCache: originalSaveFileCache });
  const app = castTo<App>({ metadataCache });
  const captureFileCache = vi.fn().mockReturnValue(isCaptured);
  const manualIndexHider = castTo<ManualIndexHider>({ captureFileCache });
  const component = new MetadataCacheSaveFileCachePatchComponent({ app, manualIndexHider });
  component.load();
  return {
    captureFileCache,
    component,
    originalSaveFileCache,
    saveFileCache: (path, fileCache) => metadataCache.saveFileCache(path, fileCache)
  };
}

describe('MetadataCacheSaveFileCachePatchComponent', () => {
  it('keeps a cache entry the hider captured out of the index', () => {
    const fixture = createFixture(true);

    expect(fixture.saveFileCache('a.md', FILE_CACHE)).toBeUndefined();

    expect(fixture.captureFileCache).toHaveBeenCalledWith('a.md', FILE_CACHE);
    expect(fixture.originalSaveFileCache).not.toHaveBeenCalled();
  });

  it('saves a cache entry the hider did not capture', () => {
    const fixture = createFixture(false);

    expect(fixture.saveFileCache('a.md', FILE_CACHE)).toBe('saved');

    expect(fixture.originalSaveFileCache).toHaveBeenCalledWith('a.md', FILE_CACHE);
  });

  it('restores the original saveFileCache on unload', () => {
    const fixture = createFixture(true);

    fixture.component.unload();
    fixture.saveFileCache('a.md', FILE_CACHE);

    expect(fixture.captureFileCache).not.toHaveBeenCalled();
    expect(fixture.originalSaveFileCache).toHaveBeenCalledOnce();
  });
});
