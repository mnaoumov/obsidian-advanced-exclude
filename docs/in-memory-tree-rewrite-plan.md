# In-memory tree rewrite plan

Replace the full-vault reconcile walk with an in-memory shadow tree plus an
incremental projection onto Obsidian's index.

## 1. Problem

The plugin currently re-drives Obsidian's reconcile machinery over the **entire**
vault every time the file tree is (re)built — `FileTreeComponent.reloadFolder`
calls `adapter.list` per folder and `reconcileFileInternal` per file, recursively.

Measured live on a 109 GB / ~90k-path real vault (Obsidian 1.13.1, via CDP):

- Ignore matching (`isIgnored` over all 90k paths): **~1 s** — not the problem.
- Full reconcile walk: **~162 s cold / ~81 s warm**, ~219k reconcile ops, fully
  serial, dominated by Obsidian's own `reconcileFile*` I/O on large attachments
  (a single PDF took 17.6 s). The long uninterrupted `await` chain also starves
  the macrotask/timer queue, so the UI and other plugins stall during the walk.

Only ~11–42 paths were actually ignored. The cost is entirely the redundant
reconcile of the ~90k files Obsidian **already** loaded natively.

## 2. Core idea

Obsidian traverses the whole disk natively on every startup regardless (it
rebuilds its index from `adapter.list` + reconcile; it does not persist a
filtered tree). The plugin should **piggyback on that single native traversal**
instead of doing a second redundant pass.

- Treat an in-memory **unfiltered shadow tree** as the plugin's source of truth.
- Treat Obsidian's index as a **filtered projection** of the shadow tree.
- Maintain the projection **incrementally**: only the ignored set is ever removed
  from / re-added to Obsidian's index.

Cost target: startup drops from ~80–160 s to **~1–2 s** (snapshot is free, match
is ~1 s, then `reconcileDeletion` only the ignored set). The only remaining
read-cost is proportional to actual ignore-set changes (e.g. un-ignoring a large
subtree), which is real work, not redundant.

We keep removing the ignored set from the index (index-level hiding) rather than
patching every consumer (search, backlinks, graph, quick switcher, …). That
preserves the plugin's "truly invisible, not just dimmed" guarantee with minimal
surface; the shadow tree is only bookkeeping that makes hiding incremental.

## 3. Visibility is computed bottom-up (negation correctness)

`.gitignore` negation (`!`) means a folder's own match verdict is **not** a safe
basis for hiding its subtree. Verified against `ignore@7.0.5`:

- `foo/bar` + `!foo/bar/baz` → everything under `foo/bar` stays ignored. Git's
  rule: a path cannot be re-included if a parent **directory** is excluded. The
  negation is a no-op.
- `foo/bar/*` + `!foo/bar/baz` → `foo/bar` and `foo/bar/baz` are **not** ignored
  (re-included), while `foo/bar/qux.md` is. The directory stays alive so
  descendants can be re-included.
- `foo/bar/*` + `!foo/bar/baz/` + `!foo/bar/baz/deep.md` → `foo/bar/baz` **tests
  ignored**, yet `foo/bar/baz/deep.md` is not, so the `baz` folder must remain in
  the tree for `deep.md` to be reachable.

Therefore visibility must be derived from the actual file set, not from folder
verdicts:

- A **file** is visible iff `!isIgnored(path)`.
- A **folder** is visible iff `!isIgnored(path)` **OR** it has any visible
  descendant file.

Implementation: mark every visible file, then propagate "visible" up the ancestor
chain. Any folder left unmarked **and** matching an ignore is hidden. This is
O(nodes), in memory.

This also fixes a latent bug in the current code: `reloadChildPath` does
`if (isIgnored(folder) && Full) { reconcileDeletion(folder); return; }` and
`reloadFolder` only recurses into non-deleted folders, so an ignored folder is
never descended into — wrongly hiding a re-included `deep.md` under it (the third
case above). The rewrite fixes this by construction. Add it as a regression test.

## 4. New components

- `VaultModelComponent` (new) — owns the shadow tree and visibility state.
  - `rebuildFromVault()` — snapshot `app.vault.getAllLoadedFiles()` into shadow
    nodes (in-memory, no disk I/O).
  - `setPath(path, isFolder)` / `deletePath(path)` — maintain shadow on live
    events (including paths Obsidian never sees because we suppress them).
  - `recomputeVisibility(path)` — recompute one node and propagate up the
    ancestor chain until visibility stops changing; returns the set of nodes
    whose visibility flipped.
  - `recomputeAll()` — full bottom-up recompute (config change / initial).
  - `isVisible(path)`, iteration helpers.
- `IndexProjectionComponent` (new — replaces `FileTreeComponent.reloadFolder`).
  - `applyFull()` — initial pass: hide every non-visible node (the ignored set +
    fully-ignored folders). No work for the visible majority.
  - `applyDelta(flippedNodes)` — hide/show each flipped node.
  - `hide(node)` — `reconcileDeletion(path)` (+ remove from files pane).
  - `show(node)` — ensure ancestor folders exist, then
    `reconcileFolderCreation` / `reconcileFileCreation` (+ add to files pane).
  - `restoreAll()` — on unload, show everything currently hidden.
- `IgnorePatternsComponent` (kept, slimmed) — stays the matcher + IndexedDB
  persistence of per-path verdicts + `.obsidianignore` / `.gitignore` reads.
  `VaultModelComponent` consumes `isIgnored`.
- `AdapterPatchComponent` and sub-patches (kept, adapted) — live reconcile
  events now (a) record the path in the shadow tree even when suppressing it, and
  (b) drive `applyDelta` for the affected path.
- `FileExplorerViewOnCreatePatchComponent` (kept) — FilesPane mode.
- `VaultLoadPatchComponent` (kept) — vault-load timing.

## 5. Data structures

A node-based tree with parent links and child maps (flat `Map<path, node>` index
for O(1) lookup):

```text
ShadowNode {
  path: string
  isFolder: boolean
  isIgnoredSelf: boolean   // matcher verdict on this exact path
  isVisible: boolean       // file => !isIgnoredSelf
                           // folder => !isIgnoredSelf || hasVisibleDescendant
  parent?: ShadowNode
  children?: Map<string, ShadowNode>  // folders only
}
```

~90k nodes ≈ ~10 MiB (measured), negligible.

## 6. Operation flows

### Startup (replaces the walk)

1. `vaultModel.rebuildFromVault()` from `getAllLoadedFiles()` — free.
2. Match every file via `isIgnored` (IndexedDB-cached) — ~1 s.
3. `vaultModel.recomputeAll()` — bottom-up visibility.
4. `indexProjection.applyFull()` — `reconcileDeletion` only the non-visible set.

### Live file event (watcher → patched adapter)

- Creation: record in shadow, recompute that path + ancestors; if not visible,
  suppress the original reconcile (Full mode) / remove from pane (FilesPane);
  else let the original run.
- Deletion: let the original run, then `deletePath` and recompute ancestors (a
  folder may flip hidden when it loses its last visible child).
- Rename: handled as delete(old) + create(new) against the shadow.

### Config change (patterns / settings / `.obsidianignore` / `.gitignore`)

1. Re-match affected files (or all) → update `isIgnoredSelf`.
2. `recomputeAll()` (or scoped recompute) → flipped node set.
3. `indexProjection.applyDelta(flipped)` — hide newly-hidden, show newly-visible.
   No full walk; cost proportional to the delta.

### Unload

`indexProjection.restoreAll()` — show every currently-hidden node (reads only the
ignored set). Should make restore reliable enough to drop / soften the existing
"reload to fully restore" warning; keep it only as a real failure fallback.

## 7. Adapter semantics to verify before/while implementing

- Does `reconcileDeletion(folderPath)` cascade-remove the subtree, or must we
  delete per descendant? Determines `hide(folder)` implementation.
- Does `reconcileFileCreation(path)` require the parent folder already present?
  (Assume yes → ensure ancestors first in `show`.)
- Which method re-adds a file with least redundant I/O — `reconcileFileCreation`
  vs `reconcileFileInternal` vs `reconcileFile`.
- Confirm `reconcileDeletion` of a file drops it from `metadataCache`
  (backlinks/graph) — the basis of "invisible everywhere".
- Confirm `getAllLoadedFiles()` is complete at `onLayoutReady` (vault loads
  before plugins; should hold).

## 8. Edge cases / risks

- **Shadow sync for suppressed paths** — the adapter patch must record paths it
  suppresses, or the shadow drifts. Main new state-keeping responsibility.
- **Un-ignoring a large subtree** — proportional reconcile/read cost. Acceptable
  and rare; surface progress as today.
- **Folder cascade vs. mixed folders** — never prune by folder verdict; rely on
  bottom-up visibility (Section 3).
- **Ancestor propagation on single flips** — a folder flips visible↔hidden when
  it gains its first / loses its last visible descendant. Walk up until stable.
- **Startup visibility window** — between native load and `applyFull`, ignored
  files are briefly in the index (and may be indexed by other plugins). This is
  identical to today's behavior (the walk also runs post-load); not a regression.
  Eliminating it would require hooking the pre-plugin load, which plugins load
  too late to do.
- **FilesPane vs Full mode** — Full removes from the index; FilesPane only from
  the explorer. The projection must branch on mode for both hide and show.

## 9. Testing (TDD)

Unit tests first, against `VaultModelComponent` (pure, deterministic):

- Visibility for the three negation cases in Section 3, including the
  folder-tests-ignored-but-has-visible-deep-file case.
- Ancestor propagation: flipping a leaf updates the right ancestors (both
  directions) and stops at the first stable folder.
- `recomputeAll` vs incremental `recomputeVisibility` agree.

`IndexProjectionComponent` with a mocked adapter (`strictProxy`):

- `applyFull` issues `reconcileDeletion` only for the ignored set, never for
  visible files (guards against any return of the full walk).
- `applyDelta` hide/show issues the expected reconcile calls and ancestor
  creations.
- `restoreAll` re-adds exactly the hidden set.

Keep existing integration tests; add a regression integration test for the
re-included-deep-file case.

## 10. Phased rollout

1. `VaultModelComponent` + visibility computation, fully unit-tested. No behavior
   change.
2. `IndexProjectionComponent`; switch the initial build from `reloadFolder` to
   `applyFull`. Keep `reloadFolder` temporarily for A/B comparison.
3. Wire live events through the model (`applyDelta`).
4. Config-change delta through the model.
5. Unload restore via `restoreAll`; relax the reload warning.
6. Delete `reloadFolder` and dead code.

## 11. Verification

Re-run the CDP harness on `F:\Obsidian` (scripts in `F:\tmp`: `cdp-eval2.cjs`,
`ae-instrument-start.js` / `ae-diag.js`). Expect:

- Startup projection ≈ 1–2 s (vs ~80–160 s today).
- `reconcileDeletion`/creation counts ≈ the ignored set + ancestors, not ~90k.
- No multi-minute timer/UI starvation; sibling plugins finish initializing.
