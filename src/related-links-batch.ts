import type {
  App,
  MetadataCache
} from 'obsidian';

type LinkMap = MetadataCache['resolvedLinks'][string];

/**
 * Collects the `metadataCache.updateRelatedLinks` calls made until the returned `resume` runs, then
 * replays them as one pass.
 *
 * Obsidian calls `updateRelatedLinks([file.name])` for every created file, and each call walks every
 * cached file's links. A bulk re-add of files hidden by an earlier session (`reconcileFile` per
 * path) therefore costs O(files × vault links): on a 91k-node real vault that pass took ~30 ms per
 * file, so re-showing a 30k-file folder spent minutes in it. One combined pass does the same work
 * once. Calls made after `resume` go straight to the original.
 */
export function suspendRelatedLinksUpdates(app: App): () => void {
  const { metadataCache } = app;
  const wasOwnProperty = Object.hasOwn(metadataCache, 'updateRelatedLinks');
  // Kept unbound so the very same function can be put back; every call passes `this` explicitly.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- see above.
  const originalUpdateRelatedLinks = metadataCache.updateRelatedLinks;
  const collectedNames: string[] = [];
  let isResumed = false;

  function collectRelatedLinks(this: MetadataCache, fileNames: string[]): void {
    if (isResumed) {
      originalUpdateRelatedLinks.call(this, fileNames);
      return;
    }
    for (const fileName of fileNames) {
      collectedNames.push(fileName);
    }
  }
  metadataCache.updateRelatedLinks = collectRelatedLinks;

  return () => {
    if (isResumed) {
      return;
    }
    isResumed = true;
    if (metadataCache.updateRelatedLinks === collectRelatedLinks) {
      if (wasOwnProperty) {
        metadataCache.updateRelatedLinks = originalUpdateRelatedLinks;
      } else {
        delete (metadataCache as Partial<MetadataCache>).updateRelatedLinks;
      }
    }
    if (collectedNames.length > 0) {
      updateRelatedLinksBatched(app, collectedNames);
    }
  };
}

/**
 * Re-queues for link resolution every file that links to any of `fileNames`: the matching
 * Obsidian's own `updateRelatedLinks` does, with `Set` lookups. Obsidian's version tests each link
 * with `Array.includes`, so handing it all the names at once would cost O(links × names) instead.
 *
 * A resolved link matches on its target's lowercased basename; an unresolved link on its
 * link text's, also trying each `.md` name without the extension.
 */
export function updateRelatedLinksBatched(app: App, fileNames: readonly string[]): void {
  const { metadataCache, vault } = app;
  const resolvedNames = new Set<string>();
  const unresolvedNames = new Set<string>();
  for (const fileName of fileNames) {
    const lowerCaseName = fileName.toLowerCase();
    resolvedNames.add(lowerCaseName);
    unresolvedNames.add(lowerCaseName);
    if (lowerCaseName.endsWith('.md')) {
      unresolvedNames.add(lowerCaseName.slice(0, -'.md'.length));
    }
  }

  for (const path of metadataCache.getCachedFiles()) {
    if (!hasMatchingBasename(metadataCache.resolvedLinks[path], resolvedNames) && !hasMatchingBasename(metadataCache.unresolvedLinks[path], unresolvedNames)) {
      continue;
    }
    const file = vault.getFileByPath(path);
    if (file) {
      metadataCache.queueFileForLinkResolution(file);
    }
  }
}

function getBasename(path: string): string {
  const slashIndex = path.lastIndexOf('/');
  return slashIndex === -1 ? path : path.slice(slashIndex + 1);
}

function hasMatchingBasename(links: LinkMap | undefined, names: ReadonlySet<string>): boolean {
  if (!links) {
    return false;
  }
  for (const link of Object.keys(links)) {
    if (names.has(getBasename(link).toLowerCase())) {
      return true;
    }
  }
  return false;
}
