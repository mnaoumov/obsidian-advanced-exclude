# Interaction with Obsidian Sync and Obsidian Publish

> Status: analysis from the code wiring (CDP inspection on `F:\Obsidian`, 2026-06-22).
> The **wiring** below is observed; the **consequences** for Sync are a strong inference
> that has NOT been verified live (verifying it risks real data loss — see below).

## How `Full` mode hides files (the relevant mechanism)

`Full` mode does not change the disk. It removes a hidden file from Obsidian's in-memory
index by calling `DataAdapter.reconcileDeletion(path)` — the same call Obsidian makes when
it detects a file was **deleted from disk**. Two consequences matter here:

1. It **fires a real `vault` `delete` event** (proven: other plugins' delete handlers run
   during a hide — that's the bulk-hide freeze).
2. It **mutates the `metadataCache`/index** so the file no longer appears in
   `getFiles()` / `getMarkdownFiles()` / metadata lookups, even though the file is still on
   disk.

Anything that reacts to delete events, or enumerates files from the index, can therefore be
fooled into thinking a hidden file was deleted.

## Obsidian Sync — HIGH RISK (potential data loss). Event-driven

Observed wiring (core `sync` plugin instance): `boundOnFileAdd` / `boundOnFileRemove` /
`boundOnFileRename` (vault event listeners), methods `onFileRemove`, `onFileRename`,
`scanFiles`, `canSyncLocalFile`, `showDeletedFiles`, and `localFiles` / `serverFiles`
state. So Sync listens to vault create/delete/rename and maintains per-file local↔server
state plus a deleted-files list.

**Inference:** when Sync is enabled, hiding a file in `Full` mode fires the `delete` event →
Sync's `onFileRemove` runs → it records the file as locally removed and (very likely)
**propagates the deletion to the server and to every other device**, while the file still
exists on the local disk. That is potential **data loss** on the cloud and other devices.

- This was **not tested live** — enabling Sync and hiding files on a real synced vault could
  actually delete data remotely. Verify only on a throwaway test vault with Sync (hide a
  file on device A, confirm whether it disappears from device B / the web).
- Sync is currently **disabled** in `F:\Obsidian`.
- **Mitigation that works:** the event-suppression fix (S2 in
  `working-with-other-plugins.md`) — withholding the per-file `delete`/`create`/`rename`
  events during the projection — would prevent Sync's `onFileRemove` from ever seeing the
  synthetic deletes. This is a strong additional reason to implement S2.
- **Mitigation available today:** `Files Pane` exclude mode does not remove from the index
  and fires no delete events, so Sync is unaffected.

## Obsidian Publish — MEDIUM RISK (wrong publish/unpublish). Index-driven

Observed wiring (core `publish` plugin instance, **enabled** here): `scanForChanges`,
`isFileSupported`, `getHashFromMetadataCache`, `getPublishFlag`, `apiUploadFile`,
`apiRemoveFile`. It enumerates and hashes via the **metadataCache** (the index).

**Inference:**

- Hidden files are absent from the index, so Publish's `scanForChanges` cannot see them →
  they **cannot be published** while hidden.
- Worse: a file that was already published and is then hidden disappears from the index →
  `scanForChanges` sees it as **deleted** → Publish would offer to **remove it from the
  published site** (`apiRemoveFile`).

- **Event suppression (S2) does NOT help Publish** — Publish reads the index directly, and
  mutating the index is the whole point of `Full` mode. So while `Full` mode is active, a
  hidden file is invisible/deleted from Publish's perspective regardless of events.
- **Mitigations:** do not hide (in `Full` mode) files you intend to keep published; use
  `Files Pane` mode for the publish-relevant subset (it leaves the index intact); or the
  view-layer-filtering approach (S4) would avoid index mutation entirely.

## Summary

| Feature          | Driven by     | Affected by `Full` mode? | Fixed by event-suppression (S2)? | Safe in `Files Pane` mode? |
|------------------|---------------|--------------------------|----------------------------------|----------------------------|
| Obsidian Sync    | vault events  | Yes — possible data loss | **Yes**                          | **Yes**                    |
| Obsidian Publish | metadataCache | Yes — wrong (un)publish  | No (index-driven)                | **Yes**                    |

`Files Pane` mode is the safe option for both (it touches only the Files-pane DOM). It is
also the no-freeze option (see `working-with-other-plugins.md`). The trade-off is that it
does not hide from Backlinks/Graph/Search.

## Action items

- [ ] Verify the Sync deletion-propagation inference on a throwaway synced vault (do NOT
      test on a real vault).
- [ ] Decide whether `Full` mode should warn when Sync and/or Publish is enabled.
- [ ] Implement S2 (protects Sync); document `Files Pane` mode as the Sync/Publish-safe mode.
