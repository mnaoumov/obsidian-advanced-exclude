import type { EventsEntry } from '@obsidian-typings/obsidian-public-latest';
import type { App } from 'obsidian';

import { noop } from '@mnaoumov/typescript-lib/function';
import { InternalPluginName } from '@obsidian-typings/obsidian-public-latest/implementations';

type Listener = EventsEntry['fn'];

/**
 * Mutes the core `File recovery` plugin's vault `create` listener until the returned `resume` runs.
 *
 * After layout ready, `File recovery` snapshots every created note: one IndexedDB cursor read for
 * the note's last version, a `cachedRead`, and one write of the whole content. A bulk re-add of
 * notes hidden by an earlier session (`reconcileFile` per path) fires `create` for each of them, so
 * re-showing a whole ~93k-note vault queued about 186k concurrent IndexedDB transactions into the
 * `<appId>-backup` database and copied the vault into it. Those notes are not new: their content is
 * unchanged on disk. A reload made while that queue drained stopped on "Loading plugins...",
 * because `File recovery`'s `onEnable` awaits opening that same database.
 *
 * Only the `create` listener is muted, so an edit made during the bulk update is still
 * snapshotted. A listener the plugin registers after this call is left alone.
 */
export function suspendFileRecoveryCreateSnapshots(app: App): () => void {
  const fileRecovery = app.internalPlugins.getEnabledPluginById(InternalPluginName.FileRecovery);
  if (!fileRecovery) {
    return noop;
  }

  const mutedEntries = new Map<EventsEntry, Listener>();
  for (const entry of app.vault._['create'] ?? []) {
    if (entry.ctx !== fileRecovery) {
      continue;
    }
    mutedEntries.set(entry, swapListener(entry, skipSnapshot));
  }

  return () => {
    for (const [entry, originalListener] of mutedEntries) {
      const currentListener = swapListener(entry, originalListener);
      if (currentListener !== skipSnapshot) {
        // Something else replaced the listener meanwhile; keep its choice.
        swapListener(entry, currentListener);
      }
    }
    mutedEntries.clear();
  };
}

function skipSnapshot(): void {
  // A re-added note is not new content; `File recovery` already has, or never needed, its snapshot.
}

/**
 * Puts `listener` on `entry` and returns the one it replaced, unbound, so the very same function
 * can go back: `Events.off` matches a listener by identity.
 */
function swapListener(entry: EventsEntry, listener: Listener): Listener {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- kept unbound on purpose, see above.
  const previousListener = entry.fn;
  // eslint-disable-next-line unicorn/name-replacements -- `fn` is the field name of Obsidian's `EventsEntry`.
  entry.fn = listener;
  return previousListener;
}
