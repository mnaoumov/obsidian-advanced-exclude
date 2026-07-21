[Docs](https://github.com/mnaoumov/obsidian-advanced-exclude/)

# Settings

Open **Settings -> Community plugins -> Advanced Exclude** to configure the plugin.
Each option below lists the setting key stored in the plugin's `data.json`.

## Ignore patterns

- `obsidianIgnoreContent` - the list of [`gitignore`](https://git-scm.com/docs/gitignore)
  patterns that decide which files and folders are ignored, one per line. This is the text
  area used in [[01 Exclude a folder]] and [[02 Whitelist with negation]]. The same content
  is mirrored in an `.obsidianignore` file at the vault root, which you can edit by hand.

## Sources

- `shouldIncludeGitIgnorePatterns` - when on (the default), also honor patterns from a
  `.gitignore` file in the vault.
- `shouldIgnoreExcludedFiles` - when on, also ignore files matched by Obsidian's core
  **Files and links > Excluded files** setting.

## Scope

- `excludeMode` - how far the exclusion reaches: `Full` hides ignored files from the whole
  app (Files pane, Backlinks, Graph, search, ...), while `FilesPane` hides them from the
  Files pane only. See [[03 Exclude mode and sources]].
- `shouldHideEmptyFolders` - when on, also hide folders left empty because every file inside
  them is excluded. This cascades to parent folders: when a folder and all of its subfolders
  become empty, the whole chain is hidden. Genuinely empty folders (with no files at all) stay
  visible.
