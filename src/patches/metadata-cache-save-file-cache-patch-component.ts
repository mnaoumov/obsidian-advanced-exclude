import type {
  App,
  MetadataCache
} from 'obsidian';

import { MonkeyAroundComponent } from '@mnaoumov/obsidian-lib/components/monkey-around-component';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';

import type { ManualIndexHider } from '../index-projection/manual-index-hider.ts';

/**
 * Constructor parameters of {@link MetadataCacheSaveFileCachePatchComponent}.
 */
export interface MetadataCacheSaveFileCachePatchComponentConstructorParams {
  readonly app: App;
  readonly manualIndexHider: ManualIndexHider;
}

type FileCacheValue = MetadataCache['fileCache'][string];

interface MetadataCacheWithSaveFileCache {
  readonly saveFileCache: (path: string, fileCache: FileCacheValue | null) => Promise<void> | undefined;
}

/**
 * Keeps a parse that finishes after its file was hidden out of the index.
 *
 * `metadataCache.computeFileMetadataAsync` reads and hashes a file asynchronously, then calls
 * `saveFileCache` and queues the file for link resolution. A file hidden in between (a file created
 * and matched by a pattern at once, or a bulk hide while the parse queue is busy) got its cache entry
 * back without being in the vault. Obsidian's `resolveLinks` then threw on the missing file, which
 * stopped its link resolver loop for the rest of the session: no link resolved again until a reload.
 * The entry goes into the file's hide snapshot instead, so a later show restores the fresh parse.
 */
export class MetadataCacheSaveFileCachePatchComponent extends MonkeyAroundComponent {
  private readonly app: App;
  private readonly manualIndexHider: ManualIndexHider;

  public constructor(params: MetadataCacheSaveFileCachePatchComponentConstructorParams) {
    super();
    this.app = params.app;
    this.manualIndexHider = params.manualIndexHider;
  }

  public override onload(): void {
    super.onload();
    this.registerMethodPatch({
      $object: castTo<MetadataCacheWithSaveFileCache>(this.app.metadataCache),
      methodName: 'saveFileCache',
      patchHandler: ({
        fallback,
        originalArguments: [path, fileCache]
      }) => (this.manualIndexHider.captureFileCache(path, fileCache) ? undefined : fallback())
    });
  }
}
