import type {
  App,
  MetadataCache,
  TAbstractFile,
  TFolder
} from 'obsidian';

import { TFile } from 'obsidian';

type FileCacheValue = MetadataCache['fileCache'][string];

/**
 * The captured Obsidian index state for one hidden path, sufficient to restore it
 * verbatim without re-reading or re-parsing the file.
 */
interface HiddenSnapshot {
  fileCache?: FileCacheValue;
  readonly inboundDemotions: InboundDemotion[];
  readonly isFile: boolean;
  readonly node: TAbstractFile;
  readonly parent: null | TFolder;
  resolvedLinks?: LinkMap;
  unresolvedLinks?: LinkMap;
}

/**
 * A resolved inbound link that was demoted to unresolved while its target was hidden,
 * recorded so it can be promoted back when the target is shown.
 */
interface InboundDemotion {
  readonly count: number;
  readonly source: string;
}

type LinkMap = MetadataCache['resolvedLinks'][string];

/**
 * Hides and shows files/folders by mutating Obsidian's in-memory index directly — without
 * calling `reconcileDeletion`/`reconcileFile` and therefore **without firing any vault or
 * metadataCache event**. This is the "direct index mutation" strategy (S6 in
 * `docs/working-with-other-plugins.md`): a `Full`-mode hide no longer triggers Obsidian's
 * per-file `removeFile → onDelete` cascade, so no other plugin (or Obsidian Sync) reacts to
 * the synthetic deletion, and the multi-minute bulk-hide freeze disappears.
 *
 * To hide, it snapshots the path's `fileMap`/`fileCache`/`resolvedLinks`/`unresolvedLinks`
 * state, removes it, and — in one batched pass over `resolvedLinks` for the whole hidden set
 * — demotes inbound links to the hidden paths to unresolved. To show, it re-inserts the
 * snapshot verbatim and re-promotes the demoted inbound links. The file explorer DOM is
 * driven separately by the caller (as in `FilesPane` mode).
 */
export class ManualIndexHider {
  private readonly app: App;
  private readonly snapshots = new Map<string, HiddenSnapshot>();

  public constructor(app: App) {
    this.app = app;
  }

  /**
   * Whether a snapshot is held for `normalizedPath` (i.e. it was hidden by {@link hide} and
   * not yet shown). The caller uses this to decide whether a show can restore cheaply.
   */
  public hasSnapshot(normalizedPath: string): boolean {
    return this.snapshots.has(normalizedPath);
  }

  /**
   * Removes every path in `normalizedPaths` from the index and demotes inbound links to them
   * in a single batched pass. Paths not currently in the index are skipped. Fires no events.
   */
  public hide(normalizedPaths: readonly string[]): void {
    const { metadataCache, vault } = this.app;
    const hiddenSet = new Set<string>();

    for (const path of normalizedPaths) {
      const node = vault.getAbstractFileByPath(path);
      if (!node) {
        continue;
      }
      const isFile = node instanceof TFile;
      const snapshot: HiddenSnapshot = { inboundDemotions: [], isFile, node, parent: node.parent };
      if (isFile) {
        const fileCache = metadataCache.fileCache[path];
        const resolvedLinks = metadataCache.resolvedLinks[path];
        const unresolvedLinks = metadataCache.unresolvedLinks[path];
        if (fileCache) {
          snapshot.fileCache = fileCache;
        }
        if (resolvedLinks) {
          snapshot.resolvedLinks = resolvedLinks;
        }
        if (unresolvedLinks) {
          snapshot.unresolvedLinks = unresolvedLinks;
        }
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- drop the file from Obsidian's internal cache maps.
        delete metadataCache.fileCache[path];
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- drop the file from Obsidian's internal cache maps.
        delete metadataCache.resolvedLinks[path];
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- drop the file from Obsidian's internal cache maps.
        delete metadataCache.unresolvedLinks[path];
      }
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- remove the path from the vault file map.
      delete vault.fileMap[path];
      removeFromParent(snapshot.parent, node);
      this.snapshots.set(path, snapshot);
      hiddenSet.add(path);
    }

    this.demoteInboundLinks(hiddenSet);
  }

  /**
   * Restores the paths that were hidden by {@link hide}, re-inserting each snapshot verbatim
   * and re-promoting its demoted inbound links. Returns the subset of `normalizedPaths` that
   * had no snapshot (e.g. files hidden before they were ever loaded) — the caller must bring
   * those back another way (a `reconcileFile` re-parse). Fires no events.
   */
  public show(normalizedPaths: readonly string[]): string[] {
    const { metadataCache, vault } = this.app;
    const withoutSnapshot: string[] = [];

    for (const path of normalizedPaths) {
      const snapshot = this.snapshots.get(path);
      if (!snapshot) {
        withoutSnapshot.push(path);
        continue;
      }

      vault.fileMap[path] = snapshot.node;
      const { parent } = snapshot;
      if (parent && !parent.children.includes(snapshot.node)) {
        parent.children.push(snapshot.node);
      }
      if (snapshot.isFile) {
        if (snapshot.fileCache) {
          metadataCache.fileCache[path] = snapshot.fileCache;
        }
        if (snapshot.resolvedLinks) {
          metadataCache.resolvedLinks[path] = snapshot.resolvedLinks;
        }
        if (snapshot.unresolvedLinks) {
          metadataCache.unresolvedLinks[path] = snapshot.unresolvedLinks;
        }
      }
      this.promoteInboundLinks(path, snapshot.inboundDemotions);
      this.snapshots.delete(path);
    }

    return withoutSnapshot;
  }

  private demoteInboundLinks(hiddenSet: Set<string>): void {
    const { metadataCache } = this.app;
    for (const [source, links] of Object.entries(metadataCache.resolvedLinks)) {
      for (const [target, count] of Object.entries(links)) {
        if (!hiddenSet.has(target)) {
          continue;
        }
        this.snapshots.get(target)?.inboundDemotions.push({ count, source });
        metadataCache.unresolvedLinks[source] ??= {};
        const unresolvedForSource = metadataCache.unresolvedLinks[source];
        unresolvedForSource[target] = count;
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- drop the resolved link to the now-hidden target.
        delete links[target];
      }
    }
  }

  private promoteInboundLinks(target: string, demotions: readonly InboundDemotion[]): void {
    const { metadataCache } = this.app;
    for (const demotion of demotions) {
      const { source } = demotion;
      metadataCache.resolvedLinks[source] ??= {};
      const resolvedForSource = metadataCache.resolvedLinks[source];
      resolvedForSource[target] = demotion.count;
      const unresolvedForSource = metadataCache.unresolvedLinks[source];
      if (unresolvedForSource) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- clear the temporary unresolved entry on restore.
        delete unresolvedForSource[target];
      }
    }
  }
}

function removeFromParent(parent: null | TFolder, node: TAbstractFile): void {
  if (!parent) {
    return;
  }
  const index = parent.children.indexOf(node);
  if (index >= 0) {
    parent.children.splice(index, 1);
  }
}
