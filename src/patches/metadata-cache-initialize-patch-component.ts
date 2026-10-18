import { MonkeyAroundComponent } from '@mnaoumov/obsidian-lib/components/monkey-around-component';
import { App } from 'obsidian';

import { suspendRelatedLinksUpdates } from '../related-links-batch.ts';

/**
 * Batches the related-links passes Obsidian runs while `metadataCache.initialize` reconciles its
 * persisted cache with the loaded vault at app startup.
 *
 * `initialize` calls `deletePath` for every cached path the vault did not load, and each
 * `deletePath` runs `updateRelatedLinks`, which walks every cached file's links. In `Full` mode a
 * hidden file is never loaded, so every path a session hid is such a path: at the next app start
 * the pass ran once per hidden path, O(hidden × cached). On a 91k-node real vault with a 30k-path
 * folder hidden that kept the main thread busy for ~270 s before the layout was ready. One combined
 * pass at the end does the same work once.
 */
export class MetadataCacheInitializePatchComponent extends MonkeyAroundComponent {
  public constructor(private readonly app: App) {
    super();
  }

  public override onload(): void {
    super.onload();
    this.registerMethodPatch({
      $object: this.app.metadataCache,
      methodName: 'initialize',
      patchHandler: async ({
        fallback
      }) => {
        const resumeRelatedLinksUpdates = suspendRelatedLinksUpdates(this.app);
        try {
          await fallback();
        } finally {
          resumeRelatedLinksUpdates();
        }
      }
    });
  }
}
