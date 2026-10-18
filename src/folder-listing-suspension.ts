import type { DataAdapterEx } from '@obsidian-typings/obsidian-public-latest';

import { noop } from '@mnaoumov/typescript-lib/function';

/**
 * Makes the adapter skip the recursive listing of `folderPaths` until the returned `resume` runs.
 *
 * When `reconcileFile` meets a folder it holds no record of, the adapter's `reconcileFolderCreation`
 * lists the folder's whole subtree with `listRecursive`, which reconciles every descendant at once,
 * with no bound on concurrency. A re-show of paths hidden by an earlier session drops each path's
 * record and then reconciles every path itself, in bounded chunks, shallowest first. After an app
 * start no descendant of a hidden folder has a record, so the listing in the first chunk created the
 * whole subtree in one burst: re-showing a ~93k-file folder held the main thread for ~8 s, and every
 * file was then reconciled and re-parsed a second time by its own chunk.
 *
 * Only the given folders are skipped. A descendant the re-show does not cover is either still
 * ignored, which the adapter patch filters out anyway, or already in the index.
 */
export function skipFolderListings(adapter: DataAdapterEx, folderPaths: ReadonlySet<string>): () => void {
  if (folderPaths.size === 0) {
    return noop;
  }

  const hasOwnListRecursive = Object.hasOwn(adapter, 'listRecursive');
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called below with the adapter as `this`.
  const originalListRecursive = adapter.listRecursive;

  async function skippingListRecursive(this: DataAdapterEx, realPath: string): Promise<void> {
    if (folderPaths.has(realPath)) {
      return;
    }
    await originalListRecursive.call(this, realPath);
  }

  adapter.listRecursive = skippingListRecursive;

  return () => {
    if (adapter.listRecursive !== skippingListRecursive) {
      // Something else replaced it meanwhile; keep its choice.
      return;
    }
    if (hasOwnListRecursive) {
      adapter.listRecursive = originalListRecursive;
    } else {
      Reflect.deleteProperty(adapter, 'listRecursive');
    }
  };
}
