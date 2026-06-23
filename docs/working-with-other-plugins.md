# Working with other plugins (the bulk-hide freeze)

## The problem

In `Full` mode, hiding a path means **removing it from Obsidian's index** (via
`DataAdapter.reconcileDeletion`) so it disappears from the Files pane, Backlinks, Graph,
Search, etc. Hiding a folder issues one `reconcileDeletion(folder)`, but Obsidian then
runs its internal `removeFile` cascade **once per descendant file**. Each per-file step
fires Obsidian's delete/metadata notifications, and **every installed plugin that listens
to them (or patches a method on the cascade path) runs synchronously, per file**.

For a large folder this is O(N × work-per-plugin) and freezes the UI for minutes.

### Measured (2026-06-22, real vault `F:\Obsidian` ~90k files, hiding `Work` ≈ 943 files)

| Source                                | Time    | How it hooks in                                                   |
|---------------------------------------|---------|-------------------------------------------------------------------|
| `consistent-attachments-and-links`    | ~33–44s | `vault` delete/rename **event listener** (`handle`)               |
| `obsidian-custom-attachment-location` | ~22–35s | called per file *by* the above (`getAvailablePathForAttachments`) |
| `backlink-cache`                      | ~11–12s | **patches** `MetadataCache.getFileCache`, hit from `onDelete`     |
| Obsidian core (unavoidable cascade)   | ~2–4s   | `removeFile` itself                                               |
| advanced-exclude itself               | ~1s     | —                                                                 |

Baseline with **only advanced-exclude loaded: ~6s total** (recompute ~2s + core cascade
~4s) and no multi-minute freeze. So the freeze is entirely third-party reaction to the
per-file delete cascade — our own code is ~1%.

**There is also a correctness hazard, not just speed:** these deletions are *synthetic*
— the file still exists on disk, it is only hidden. Plugins that react to a "delete" by
mutating the vault (rewriting links, removing "orphaned" attachments) can do the wrong
thing.

## Two hook shapes (this determines which fix works)

1. **Event listeners** — `vault.on('delete'|'rename'|'create')`,
   `metadataCache.on('deleted'|'changed')`. Example: `consistent-attachments-and-links`
   (and, transitively, `custom-attachment-location`). These can be stopped by suppressing
   the event *dispatch* during the projection.
2. **Method patches on the cascade path** — e.g. `backlink-cache` monkey-patches
   `MetadataCache.getFileCache`, which Obsidian core calls from `onDelete`. Suppressing
   events does **not** stop these; they run inside Obsidian's own cascade.

This is the same class of problem we already solved once for Obsidian core itself:
`MetadataCache.updateRelatedLinks` was O(N²) during a bulk hide, and we batch it during
the projection (`IndexProjectionComponent.installRelatedLinksBatching`). The options below
generalize that idea to third-party code.

## Candidate solutions

### S0 — `Files Pane` exclude mode (today, no code change)

`FilesPane` mode hides via the file-explorer DOM only and never removes anything from the
index, so there is **no `removeFile` cascade and no plugin reaction → no freeze**.
Trade-off: it does not hide from Backlinks/Graph/Search. This is the immediate
recommendation for large vaults and should be called out in the settings UI.

### S1 — Shared "bulk operation in progress" signal (covers cooperating plugins)

Expose the already-tracked `isApplyingProjection` app-wide (e.g. `app.advancedExclude
?.isApplyingProjection`, or a tiny shared module, or a documented `CustomEvent` pair
`advanced-exclude:bulk-start` / `:bulk-end`). Cooperating plugins check it and **skip**
their per-file delete/rename handling while it is set.

- Pros: trivial, robust, also fixes the synthetic-deletion correctness hazard, zero
  fragility.
- Cons: only helps plugins that **opt in**. Perfect for the maintainer's own plugins
  (`consistent-attachments-and-links`, `custom-attachment-location`, `backlink-cache` —
  which are 100% of the measured freeze here), useless for arbitrary third parties.
- This is the cleanest fix for the plugins we control; see each plugin's `CLAUDE.md`.

### S2 — Suppress event dispatch during the projection (generic, covers hook-shape #1)

While `beginProjection`/`endProjection` is active in `Full` mode, temporarily wrap
`app.vault.trigger` and `app.metadataCache.trigger` to swallow the per-file
`delete`/`rename`/`create`/`deleted`/`changed` events, so **no event-listener plugin runs
per file**. The index is still updated (we still call `reconcileDeletion`); only the
*notifications* are withheld. At `endProjection`, refresh the essential UI ourselves:

- the file-explorer DOM (we already do this in `FilesPane` mode via
  `addToFilesPane`/`deleteFromFilesPane`), and
- optionally fire one coalesced event so views can do a single refresh.

- Pros: generic for the common case (most plugins are event listeners); no per-plugin
  coordination; same spirit as the existing `updateRelatedLinks` batching.
- Cons / risks:
  - Does **not** stop method-patchers like `backlink-cache` (hook-shape #2) — those run
    inside Obsidian's own `onDelete` regardless of event suppression.
  - Withholding events from *all* listeners can desync plugins that legitimately needed
    them; we must be sure the synthetic hide/show is invisible-by-design (the file still
    exists, so "no event" is arguably correct), and we must drive any core UI that relied
    on the event.
  - Fragile against Obsidian internals changing how it dispatches.

### S3 — Neutralize specific hot methods during the projection (covers hook-shape #2)

Generalize `installRelatedLinksBatching`: during the projection, also temporarily replace
the specific methods that the cascade calls and that plugins patch (e.g. wrap
`metadataCache.getFileCache` so it returns cheaply / from a snapshot during projection).

- Pros: can defuse method-patchers like `backlink-cache`.
- Cons: we are guessing which methods third parties patch — not truly generic, and
  brittle (we are patching over other plugins' patches; order-dependent).

### S4 — Don't remove from the index at all; filter at the view layer

Instead of `reconcileDeletion`, keep files in the index and filter them out at each
consumer (Files pane, Backlinks, Graph, Search…). Eliminates the cascade entirely.

- Pros: no per-file events ever; cheap hides.
- Cons: requires patching every view/consumer (large, ongoing maintenance) and is exactly
  what removing-from-index was meant to avoid. Effectively a rewrite of the plugin's
  strategy.

### S5 — Upstream

Propose an Obsidian API for bulk index mutation that does not broadcast per-file (a
"suspend notifications / bulk apply / resume" bracket), and/or report the per-file O(N)
behavior of the deletion cascade. Long-term, not actionable now.

### S6 — Direct index mutation: stop calling `reconcileDeletion`/`reconcileFile` (IMPLEMENTED)

> **Status: shipped.** `Full`-mode hide/show is now done by `ManualIndexHider`
> (`src/manual-index-hider.ts`), wired into `IndexProjectionComponent`. A hide mutates
> `vault.fileMap`/`fileCache`/`resolvedLinks`/`unresolvedLinks` directly and fires no events;
> the file explorer is driven explicitly. Validated end to end in real Obsidian
> (`vault-size-scaling` / `ignore-patterns` / `manual-index-hide` desktop integration). Two
> items from the plan are intentionally deferred (see "Resolved during implementation" below):
> the single coalesced graph/backlinks refresh, and the show-path `mtime`/`size` staleness
> check. The design as built is described next.

Instead of asking Obsidian to reconcile (which runs `removeFile → onDelete → …`, fires the
public `delete`/`create` events, and runs `updateRelatedLinks`), **mutate the few internal
structures we actually need, directly, and fire nothing.** A hidden file simply disappears
from Obsidian's view without any "deletion" being announced.

Why this beats S2/S3: the profile shows the worst third-party cost is reached *inside*
Obsidian's own cascade — `reconcileDeletion → removeFile → metadataCache.onDelete →
getFileCache` (which `backlink-cache` patches). That path is **not** a public event, so
S2 (event suppression) cannot stop it. Not calling `reconcileDeletion` at all skips
`removeFile`/`onDelete` entirely, so `backlink-cache` (internal hook), `consistent-
attachments-and-links` (event listener), `custom-attachment-location`, **and Obsidian
Sync** all never run. Expected hide cost drops to ~the recompute + the map mutations
(seconds, yieldable), with zero broadcast.

**To HIDE a file, replicate what `reconcileDeletion` touches (confirmed internals):**

- `vault.fileMap`: `delete fileMap[path]`, and remove the entry from its parent folder's
  `children` array (so `getAbstractFileByPath` / `getFiles` no longer return it).
- `metadataCache`: remove `fileCache[path]`, the linked `metadataCache[hash]`,
  `resolvedLinks[path]`, `unresolvedLinks[path]`.
- Inbound references (other files whose `resolvedLinks` point at the hidden file): these
  may otherwise leave the hidden file showing up as a resolved link target in Graph/links,
  so they likely need updating. Do it **once, batched** (a single O(N) pass over
  `resolvedLinks`, or — better — look up only the linkers via `getBacklinksForFile`), never
  per hidden file (that is the O(N²) trap the current `updateRelatedLinks` batching already
  works around). An integration test must confirm whether skipping this is actually
  harmless (target no longer in `fileMap` ⇒ treated as unresolved) or whether the demote
  pass is required.
- File explorer: `fileExplorerView.onDelete(file)` (we already do this in `FilesPane`
  mode via `deleteFromFilesPane`).
- Graph / Backlinks / Search: these read from `metadataCache`/`vault`; nudge them **once**
  at the end of the projection (a single coalesced refresh) rather than per file.

**To SHOW a file again — snapshot on hide, restore on show (no re-parse, no disk I/O):**
When hiding, **capture** the exact state before removing it: the `TFile` object reference,
`fileCache[path]`, `metadataCache[hash]`, `resolvedLinks[path]`, `unresolvedLinks[path]`
(and any inbound-link demotions made). To show, **re-insert** that captured state verbatim
(same `TFile` identity) and call `fileExplorerView.onCreate(file)`. This makes the show
path O(1) per file — pure map writes, no file read, no metadata compute, no `reconcileFile`
cascade.

- *Staleness*: if the file changed on disk while hidden, the snapshot is stale. On show,
  compare the file's current `mtime`/`size` to the snapshot; if unchanged, restore the
  snapshot (fast path); if changed (or no snapshot exists — e.g. captured before initial
  metadata parse completed), fall back to a re-parse (`reconcileFile` with events
  suppressed). This keeps the common case (file untouched while hidden) instant and the
  rare case correct.
- *Capture timing*: the snapshot is taken fresh whenever we hide (runtime config change or
  the per-session initial projection), so it never needs to be persisted across an Obsidian
  restart — after a restart Obsidian re-parses on load and we snapshot again at hide time.
- *Memory*: holding `CachedMetadata` for the hidden set keeps memory that would otherwise be
  freed; small per file, fine for typical hidden sets, worth noting if hiding ~all of a 90k
  vault.

**Risks / how to de-risk:**

- *Fragility*: `fileMap` / `metadataCache` internals are undocumented and can change across
  Obsidian versions. Mitigate with `obsidian-typings` augmentations, defensive guards, and
  a `*.desktop.integration.test.ts` that runs in a real vault.
- *Completeness*: a hidden file must vanish from **every** consumer. Add integration
  assertions that after a hide it is absent from: Files pane, `getFiles()`,
  `getAbstractFileByPath`, `metadataCache.getFileCache`, `getBacklinksForFile`, the search
  results, and the graph; and after a show it returns to all of them. Missing a consumer is
  the main hazard.
- *`backlink-cache` staleness*: bypassing its hook leaves its reverse index holding the
  hidden file's links until the next real change. Harmless (the file is hidden), but nudge
  it on show if needed.
- *Does not help Publish*: Publish reads the index, which we still mutate — so a `Full`
  hide is still invisible/deleted to Publish. Only `Files Pane` mode or view-layer
  filtering (S4) protects Publish. (See `sync-and-publish.md`.)

## Recommendation

- **Now (zero code):** document/recommend **S0 (`Files Pane` mode)** for large vaults and
  for anyone using Sync/Publish — it touches only the Files-pane DOM, so it has no freeze,
  no Sync hazard, and no Publish hazard.
- **The real fix (now shipped): S6 — direct index mutation, no `reconcileDeletion`/
  `reconcileFile`.** This is the only option that fixes *all* of the problems at once for
  plugins we don't own: the freeze (no `removeFile`/`onDelete` cascade → no third-party
  reaction, including `backlink-cache`'s internal `getFileCache` hook), the
  synthetic-deletion correctness hazard, and **Obsidian Sync** data-loss risk (no events →
  Sync never sees a deletion). It supersedes S2 (which can't stop the internal `getFileCache`
  path) and S1 (which only helps our own plugins). Implemented as `ManualIndexHider` +
  `IndexProjectionComponent`.
- **S1** is still worth doing for our own plugins as defense-in-depth and because those
  plugins are independently slow on real bulk deletes (see their `CLAUDE.md`), but it is no
  longer the primary fix.
- **Publish** is unaffected by S2/S6 (it reads the index). Only `Files Pane` mode (S0) or
  view-layer filtering (S4) protects it.

## Resolved during implementation

1. **Minimal removal set for HIDE.** Per path: `delete vault.fileMap[path]` and splice it from
   its parent's `children`; `delete fileCache[path]`, `delete resolvedLinks[path]`,
   `delete unresolvedLinks[path]`. The linked `metadataCache[hash]` is **left in place** — with
   `fileCache[path]` gone there is no path→hash mapping, so `getFileCache(path)` returns `null`;
   restoring `fileCache[path]` on show re-points to the still-present hash entry, which is how
   show needs no re-parse. Integration assertions confirm a hidden path is absent from
   `getAbstractFileByPath`/`getFiles`/`getCache` and its inbound links demote to unresolved.
2. **SHOW path.** Snapshot-restore re-inserts the captured `fileMap`/`fileCache`/`resolvedLinks`/
   `unresolvedLinks` verbatim and re-promotes the demoted inbound links; the explorer is driven
   by `addToFilesPane` (`onCreate`). A path with **no** snapshot (hidden by a prior session,
   never loaded) falls back to `reconcileFile`. The `mtime`/`size` staleness check is **deferred**
   — a file edited on disk *while hidden* would restore a stale snapshot until its next real
   change; rare, tracked as a follow-up.
3. **Coalesced graph/backlinks refresh — deferred.** The link graph is kept *correct* by the
   batched inbound demote, but no single end-of-projection refresh is emitted, so open
   Graph/Backlinks views may render stale until the next interaction. Follow-up.
4. **`updateRelatedLinks` batching — removed.** With no `reconcileDeletion` there is no per-file
   `updateRelatedLinks` cascade to coalesce.
5. **Version-fragility guardrails.** The internals are typed via `@obsidian-typings` (`fileMap`,
   `fileCache`, `resolvedLinks`, `unresolvedLinks`); the desktop integration tests assert the
   hide/show behavior against a real vault, so an Obsidian change to these internals fails loudly.
