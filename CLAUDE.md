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

Added `src/vault-size-scaling.desktop.integration.test.ts`: generates 100/1000/3000-file
folders and drives the exact live "edit settings to change ignores" flow
(`editAndSave` → `processConfigChanges`). Asserts the folder collapses to exactly
one `reconcileDeletion` (its hide-root), all files vanish, and removing the pattern
re-shows the whole folder — all independent of size, a regression guard for the
freeze that replaces manual big-vault testing. All three sizes pass on desktop.
Pending: Android integration needs an emulator (unavailable here); review/merge to
`master`.

## Known Issues

None.
