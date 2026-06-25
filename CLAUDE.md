# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Obsidian plugin that enhances Obsidian's `Files and links > Excluded files` setting with full `gitignore` syntax. Ignored files become invisible to Obsidian (Files pane, Backlinks, etc.), not just dimmed.

Built on `obsidian-dev-utils`. Patches Obsidian's `FileSystemAdapter` / `CapacitorAdapter` and `FileExplorerView` to filter ignored paths at the source.

## Commands

| Task              | Command                    |
|-------------------|----------------------------|
| TypeScript check  | `npm run build:compile`    |
| Build             | `npm run build`            |
| Dev (watch)       | `npm run dev`              |
| Lint              | `npm run lint`             |
| Lint (fix)        | `npm run lint:fix`         |
| Format            | `npm run format`           |
| Format (check)    | `npm run format:check`     |
| Spellcheck        | `npm run spellcheck`       |
| Markdown lint     | `npm run lint:md`          |
| Markdown lint fix | `npm run lint:md:fix`      |
| Unit tests        | `npm test`                 |
| Coverage          | `npm run test:coverage`    |
| Integration tests | `npm run test:integration` |
| Commit (wizard)   | `npm run commit`           |

## Architecture

- **Root config files** are thin re-exports — actual logic lives in `scripts/`:
  - `eslint.config.mts` → `scripts/eslint-config.ts`
  - `commitlint.config.ts` → `scripts/commitlint-config.ts`
  - `vitest.config.ts` → `scripts/vitest-config.ts`
  - `.markdownlint-cli2.mjs` → `scripts/markdownlint-cli2-config.ts` (via jiti)
  - `.nano-staged.mjs` → `scripts/nano-staged-config.ts` (via jiti)
- **`scripts/`** — all npm script entry points (`jiti scripts/<name>.ts`)
- **`src/`** — plugin source:
  - `main.ts` — Obsidian entry point (default export of `Plugin`)
  - `plugin.ts` — `Plugin` class, wires up child components
  - `ignore-patterns-component.ts` — owns gitignore matching, IndexedDB cache, `.obsidianignore` / `.gitignore` reads
  - `file-tree-component.ts` — drives Files pane add/delete based on ignore state
  - `data-adapter-safe.ts` — read/write/stat wrappers that survive missing files
  - `plugin-settings*.ts` — settings model, component, settings tab
  - `patches/` — monkey-patches on Obsidian internals:
    - `adapter-patch-component.ts` — dispatches to file-system or capacitor variant
    - `file-system-adapter-patch-component.ts`, `capacitor-adapter-patch-component.ts` — patch `reconcileFile{Creation,Internal}`
    - `vault-load-patch-component.ts` — intercepts initial vault load
    - `file-explorer-view-on-create-patch-component.ts` — patches `FileExplorerView.onCreate`
- **Test files** live next to the source: `foo.ts` → `foo.test.ts`. Integration tests use suffixes `.desktop.integration.test.ts` / `.android.integration.test.ts`.
- **`main` field** points to `src/main.ts` (Obsidian plugin source entry — built artifact is `dist/build/main.js`, not published to npm).

## Conventions

- **Mocking**: prefer `strictProxy<T>({...})` / `StrictProxyPartial<T>` from `obsidian-dev-utils/strict-proxy` over `as unknown as T` and over `Record<string, unknown>` mock interfaces. Strict proxies throw on uninitialized property access, so mistakes surface in the failing test instead of silently passing.
- **Constructor params**: components take a single `{...}Params` object. When mocking a component constructor in tests, type the params with the real exported `...ConstructorParams` interface — export the interface from the source file if needed.
- **v8 ignore**: only block form (`/* v8 ignore start -- reason. */` … `/* v8 ignore stop */`) is honored. Single-line `/* v8 ignore next */` does not work.
- **Commit messages**: Conventional Commits. Use `npm run commit` (czg) for the interactive wizard.

## Current Task

**Pending dev-utils release — simplify the projection yield.** `obsidian-dev-utils`
commit `fa07bc1e` ("feat: add fallback to requestAnimationFrameAsync") moved the
rAF-vs-timeout race into `requestAnimationFrameAsync(fallbackTimeoutInMilliseconds = 100)`
itself — identical default to the plugin's local `yieldToPaint()`. It is committed in
dev-utils but **not yet published** (npm latest `80.1.0` predates it; the maintainer will
release a new version). Once a dev-utils version containing `fa07bc1e` is published and
installed: bump the plugin's `obsidian-dev-utils` dependency, then in
`src/index-projection-component.ts` delete `yieldToPaint()` and `BACKGROUND_YIELD_FALLBACK_MS`
and call `requestAnimationFrameAsync()` directly at both yield points (recompute `yieldFn`
and `reportApplyProgress`); keep the "keeps progressing when the window is hidden" test (it
still passes against the library's built-in fallback). Do NOT refactor before then — the
no-arg call against the current `80.1.0` has no fallback, so the hidden-window test would hang.

## Design & History (S6, publish-compatibility, in-memory tree rewrite)

**Publish-compatibility warning shipped.** `src/publish-compatibility-warning-component.ts`
(a `LayoutReadyComponent`, wired in `plugin.ts`) warns when Obsidian Publish is enabled
while `excludeMode === Full` (the only unsafe combo; `Files Pane` mode is Publish-safe). The
warning notice offers four actions: disable Advanced Exclude, switch to Files Pane mode,
disable the Publish core plugin, or cancel (acknowledge the risk). It revalidates on plugin
load (`onLayoutReady`), on `app.internalPlugins` `'change'` (Publish enable/disable), and on
settings `saveSettings` (exclude-mode change). The Publish plugin instance implements only
`onEnable`/`onDisable` (not `onUserEnable`/`onUserDisable`), so the live hook is the
`internalPlugins` `'change'` event, not a `registerMethodPatch` on `onUserEnable` (that
would wrap `undefined` and crash). See `docs/sync-and-publish.md` (Publish section).

**S6 (direct index mutation) shipped.** `Full`-mode hide/show no longer calls
`reconcileDeletion`/`reconcileFile`. `ManualIndexHider` (`src/manual-index-hider.ts`)
removes files from the index directly and fires no events; `IndexProjectionComponent`
batches the whole hidden set into one event-free pass and drives the file explorer
explicitly. This removes the multi-minute bulk-hide freeze, the synthetic-deletion hazard,
and the Obsidian Sync data-loss path. Validated end to end in real Obsidian
(`ignore-patterns` + `vault-size-scaling` desktop integration); full unit suite + 100%
coverage. See `docs/working-with-other-plugins.md` (S6) and the Known Issues. The show-path
`mtime`/`size` staleness check is now implemented (`invalidateStaleSnapshot` +
`ManualIndexHider.dropStaleSnapshot`); the one remaining deferred follow-up is a coalesced
graph/backlinks refresh. The historical context below predates S6 — read it with that in mind.

Real-vault-scale (~90k) end-to-end testing, via populate-before-open. The harness
feature has shipped: `obsidian-integration-testing` (now `^4.3.0`) gained
`coreSetup({ populate })` + `createSetup({ populate })` so a vault is written with
`TempVault.populate()` **before** Obsidian opens it — its startup scan indexes
everything in one pass (no `app:reload`, no per-file `adapter.write`). The plugin
consumes it via `scripts/vitest-global-setup-performance.ts`
(`createSetup({ populate })`) + `scripts/helpers/generate-performance-vault.ts` +
a new `integration-tests:desktop-performance` vitest project running
`src/vault-real-scale.desktop-performance.integration.test.ts`.

In-memory shadow-tree rewrite (plan: `docs/in-memory-tree-rewrite-plan.md`).
Implemented on branch `feat/in-memory-tree`: `VaultModel` (shadow tree +
bottom-up visibility) and `IndexProjectionComponent` replace the whole-vault
reconcile walk — initial load snapshots Obsidian's loaded tree and removes only
the ignored hide-roots; config changes apply a persistent-model delta; live
adapter events sync the model; unload shows a reload notice when paths are
hidden. The full known-path set is persisted in IndexedDB (`VaultPathStore`) so
a mid-session disable/enable can re-show files whose pattern changed (Obsidian
does not re-scan disk then). 200 unit tests, 100% coverage; desktop integration
9/9. Verified live: clean enable ~12 s vs ~80–160 s, zero reconcile walk
(persist load ~1 ms, missing-scan ~16 ms — negligible; persists only the hidden
set, not all 90k paths).

`IndexProjectionComponent` exposes `isApplyingProjection` (set for the duration of
`update()`); the adapter patch's `reconcileDeletion` skips `recordDelete` while it is set
(under S6 this is dormant — the projection no longer issues `reconcileDeletion`, so it only
guards against a concurrent *real* delete during a projection). `update()` persists the
hidden set after each `applyDelta`, so a later reload reconstructs it. Under S6 the same
hidden set is also snapshotted in memory by `ManualIndexHider`, so a same-session un-ignore
re-shows hidden files instantly from the snapshot (no reload, no re-parse); a path with no
snapshot (hidden by a prior session) falls back to `reconcileFile`. That fallback must first
`delete adapter.files[path]`: `ManualIndexHider.hide` leaves the adapter's own stat record
intact, so without dropping it `reconcileFile` compares disk against the stale record, sees
no change, and re-adds nothing (the file would stay hidden forever).

Scaling is covered at three levels.

`src/vault-size-scaling.desktop.integration.test.ts` (real Obsidian, `Full` mode,
end to end): a generic driver that builds a vault, drives the live "edit settings
to change ignores" flow (`editAndSave` → `processConfigChanges`), and asserts the
event-free hide (zero in-scope `reconcileDeletion`) plus full hide/re-show. Shapes: flat
1000/5000-file folders, a deep+wide nested tree (breadth 4 × depth 4 ≈ 341 folders
→ one hide-root), and 200 independently-ignored sibling folders (one hide-root
each, cost is O(hide-roots) not O(files)). Timeouts are sized from the file count
(`60 s + 20 ms × files`).

`src/vault-model-scaling.no-app.integration.test.ts` (no Obsidian, no disk):
exercises `VaultModel` directly at 90,000 and 1,000,000 files (single ignored
folder → one hide-root) and 10,000 / 100,000 independently-ignored folders. Bench:
`recomputeAll` ~40 ms at 100k, ~420 ms at 1M, ~4.5 s at 10M; ~390 MB/million nodes.
This proves the **plugin's** hide work is O(N log N) and ~milliseconds at the
maintainer's full vault size.

`src/vault-real-scale.desktop-performance.integration.test.ts` (real Obsidian, the
`integration-tests:desktop-performance` project, ~90k populated before open): hides
the whole vault folder in **`FilesPane` mode** and asserts the explorer is cleared
(~0.8 s at 90k). `FilesPane` is used here because it is the fastest mode (pure DOM); since
S6, `Full` mode also hides without the freeze, but `FilesPane` remains the cheapest at 90k.

## Known Issues

- **`Full`-mode bulk-hide freeze — RESOLVED by S6 (direct index mutation).** A
  `Full`-mode hide now removes files from the index directly via `ManualIndexHider`
  (`src/manual-index-hider.ts`), wired into `IndexProjectionComponent`. It calls neither
  `reconcileDeletion` nor `reconcileFile`, so it fires **no** `vault`/`metadataCache`
  events — which removes both freeze sources at once:
  - Obsidian's own O(N²): the `MetadataCache.deletePath` → `updateRelatedLinks`
    whole-vault scan (once per deleted file: 20k 40 s, 90k ~16 min) no longer runs at all
    (no `reconcileDeletion`). The earlier "Option A" batching (monkey-patching
    `updateRelatedLinks` to one flush) is therefore **removed** as unnecessary. Guarded by
    `src/vault-full-hide-diagnostic.desktop-performance.integration.test.ts`, now asserting
    **zero** real `updateRelatedLinks` calls for a whole-folder hide.
  - Third-party reactions: profiling (CDP, real `F:\Obsidian`, ~943 files) showed the
    multi-minute freeze was **other plugins** reacting to the per-file `removeFile →
    onDelete`/`delete` cascade — `consistent-attachments-and-links` (~33–44 s),
    `custom-attachment-location` (~22–35 s), `backlink-cache` (~11–12 s via its internal
    `getFileCache` hook). With no cascade, none of them run. It also removes the
    synthetic-deletion correctness hazard (the file is still on disk) and the Obsidian Sync
    data-loss path (`onFileRemove` never sees a hide). Design + the full root-cause
    breakdown: `docs/working-with-other-plugins.md` (S6); Sync/Publish:
    `docs/sync-and-publish.md`.

  `FilesPane` mode remains the absolute fastest (pure DOM `onDelete`, ~0.8 s at 90k) and is
  the only mode that is also Publish-safe (it never mutates the index). The show-path
  `mtime`/`size` staleness check is now implemented (`invalidateStaleSnapshot` +
  `ManualIndexHider.dropStaleSnapshot`): a file edited on disk while hidden is detected by a
  stat comparison on show and re-parsed instead of restoring a stale snapshot. One S6
  follow-up remains deferred (tracked in `docs/working-with-other-plugins.md`): a single
  coalesced graph/backlinks refresh at end-of-projection. The per-plugin performance
  findings still stand (each is independently slow on
  *real* bulk deletes) and remain in each plugin's `CLAUDE.md`.

- **Progress-bar smoothness — RESOLVED (yield switched to rAF; verified live).** Two
  real issues found in the progress-bar/async work that ARE ours were fixed earlier
  (queue-bound + async recompute + apply-phase yields). The remaining symptom — the
  cooperative `setImmediate` yield not reliably repainting the bar in a real foreground
  session (bar sticks at chunk boundaries) — is fixed: both yield points in
  `IndexProjectionComponent` (the recompute `yieldFn` and `reportApplyProgress`) go through
  a new module-level `yieldToPaint()` that races `requestAnimationFrameAsync()` against
  `setTimeoutAsync(BACKGROUND_YIELD_FALLBACK_MS)` (100 ms). The rAF leg aligns the resume
  with the next paint so the bar advances visibly; the timeout leg is the fallback for an
  unfocused/hidden window (where rAF is suspended) so a background projection keeps
  progressing instead of stalling on a frame that never arrives — the exact hidden-window
  hazard that previously argued against plain rAF. Unit-covered (incl. a "keeps progressing
  when the window is hidden" test that stubs rAF to never fire); 100% coverage.
  **Verified live** via CDP on `F:\Obsidian` (~90k files, `Full` mode, foreground window):
  a delta-path recompute advanced the bar through **35 distinct values** (clean 5000-step
  staircase) over ~0.85–1.1 s, with **one serviced animation frame per chunk** at a
  **median 18–20 ms inter-frame gap** (~50 fps; all gaps 3–22 ms in the steady run) — i.e.
  the renderer paints each step rather than the bar jumping at the end. Note on the
  follow-up to swap `yieldToPaint()` for the library's built-in fallback (see Current Task):
  that change is purely mechanical and preserves this behavior (same 100 ms default).
