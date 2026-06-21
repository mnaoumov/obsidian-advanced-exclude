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
`update()`); the adapter patch's `reconcileDeletion` skips `recordDelete` while it
is set, so the projection's own hide calls no longer drop the hidden subtree from
the model. `update()` also persists the hidden set after each `applyDelta`, so a
later reload reconstructs it. Together these make a same-session un-ignore re-show
hidden files without a reload.

Scaling is covered at three levels.

`src/vault-size-scaling.desktop.integration.test.ts` (real Obsidian, `Full` mode,
end to end): a generic driver that builds a vault, drives the live "edit settings
to change ignores" flow (`editAndSave` → `processConfigChanges`), and asserts
deletions scoped to the ignored paths plus full hide/re-show. Shapes: flat
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
(~0.8 s at 90k). See Known Issues for why this is `FilesPane`, not `Full`.

## Known Issues

- **`Full`-mode hide of a huge folder — Obsidian's O(N²) cascade, now batched
  around.** Obsidian's `MetadataCache.deletePath` → `updateRelatedLinks` scans
  **every** file in the vault (`getCachedFiles()`) to find backlinks to the deleted
  file, run **once per deleted file** → O(N²) (20k 40 s, 90k ~16 min; confirmed the
  *sole* quadratic by stubbing only `updateRelatedLinks` — the rest of the cascade
  is ~linear, so a stubbed 90k hide is ~9 s).
  **Fixed here (Option A):** `IndexProjectionComponent` monkey-patches
  `updateRelatedLinks` for the duration of a `Full`-mode projection (`beginProjection`
  /`endProjection` around the existing `applyingProjectionDepth`), collecting the
  per-file names instead of scanning, then issues **one** call at the end — by then
  the hidden files are gone from `getCachedFiles()`, so that single scan is cheap.
  Needs the `src/obsidian-internals.d.ts` augmentation (the public typings mistype
  `updateRelatedLinks(path: string)`; it really takes `string[]`). Measured: **20k
  40 s → 1.4 s (28×), 90k ~16 min → 9.3 s (~104×)**, one real call instead of 90k,
  hide still correct (in-scope index → 0). Guarded by
  `src/vault-full-hide-diagnostic.desktop-performance.integration.test.ts` (asserts
  exactly one real call; size via `AE_PERF_VAULT_SIZE`). `FilesPane` mode is still
  the absolute fastest (DOM `onDelete`, ~0.8 s at 90k). The more general fix (a
  reverse-index patch in `backlink-cache`, fixing any plugin's bulk delete) is
  tracked in `obsidian-backlink-cache/CLAUDE.md`. Worth reporting the O(N²) upstream
  to Obsidian.
