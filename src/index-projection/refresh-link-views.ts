import type { App } from 'obsidian';

import { ViewType } from '@obsidian-typings/obsidian-public-latest/implementations';

/**
 * Redraws open global/local graphs and recomputes link side-panes after a
 * `Full`-mode projection. The projection mutates the link index without firing events, so
 * these views would otherwise render stale links (a hidden file lingering as a backlink)
 * until the next interaction: their components recompute only on an active-file change or
 * a `metadataCache` event, neither of which the projection fires. Each component caches
 * the file it last rendered in its `*File` fields and its `update()` short-circuits while
 * they still match the active file, so clearing those trackers (but not `file`, the current
 * target) makes `update()` recompute. Graph views redraw from the current index directly.
 * Refresh each open view once, without vault or metadata events. Deferred leaves are skipped.
 */
export function refreshLinkViews(app: App): void {
  for (const leaf of app.workspace.getLeavesOfType(ViewType.Graph)) {
    if ('dataEngine' in leaf.view) {
      leaf.view.update();
    }
  }
  for (const leaf of app.workspace.getLeavesOfType(ViewType.LocalGraph)) {
    if ('engine' in leaf.view) {
      leaf.view.update();
    }
  }
  for (const leaf of app.workspace.getLeavesOfType(ViewType.Backlink)) {
    if (!('backlink' in leaf.view)) {
      continue;
    }

    const { backlink } = leaf.view;
    backlink.backlinkFile = null;
    backlink.unlinkedFile = null;
    backlink.update();
  }
  for (const leaf of app.workspace.getLeavesOfType(ViewType.OutgoingLink)) {
    if (!('outgoingLink' in leaf.view)) {
      continue;
    }

    const { outgoingLink } = leaf.view;
    outgoingLink.outgoingFile = null;
    outgoingLink.unlinkedFile = null;
    outgoingLink.update();
  }
}

/**
 * Re-runs the query of every open search view, so its results follow a changed `isUserIgnored`. Deferred leaves are
 * skipped.
 */
export function refreshSearchViews(app: App): void {
  for (const leaf of app.workspace.getLeavesOfType(ViewType.Search)) {
    if ('startSearch' in leaf.view) {
      leaf.view.startSearch();
    }
  }
}
