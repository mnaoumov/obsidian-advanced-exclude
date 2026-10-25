# Settings

Open **Settings -> Community plugins -> `Advanced Exclude`** to configure the plugin. Each option below lists the setting key stored in the plugin's `data.json`.

## Ignore patterns

- `obsidianIgnoreContent`
  - the list of [`gitignore`](https://git-scm.com/docs/gitignore) patterns that decide which files and folders are ignored, one per line. This is the text area used in [01 Exclude a folder](<./01 Exclude a folder.md>) and [02 Whitelist with negation](<./02 Whitelist with negation.md>). Stored here, it syncs with [Obsidian Sync](https://help.obsidian.md/sync) like every other setting.

## Sources

- `shouldIncludeObsidianIgnorePatterns`
  - when on, also honor patterns from a `.obsidianignore` file at the vault root, after the patterns above. Off by default. Sync does not carry the file, since its name starts with a dot, so it suits rules for one device. See [03 Exclude mode and sources](<./03 Exclude mode and sources.md>).
- `shouldIncludeGitIgnorePatterns`
  - when on, also honor patterns from a `.gitignore` file in the vault. Off by default, so a fresh install never applies your vault's `.gitignore` until you ask it to.
- `shouldIgnoreExcludedFiles`
  - when on, also ignore files matched by Obsidian's core **Files and links > Excluded files** setting.

## Scope

- `excludeMode`
  - how far the exclusion reaches: `Full` hides ignored files from the whole app (Files pane, Backlinks, Graph, search, ...), while `FilesPane` hides them from the Files pane only. See [03 Exclude mode and sources](<./03 Exclude mode and sources.md>).
- `shouldHideEmptyFolders`
  - when on, also hide folders left empty because every file inside them is excluded. This cascades to parent folders: when a folder and all of its subfolders become empty, the whole chain is hidden. Genuinely empty folders (with no files at all) stay visible.

## Profiles

- `profiles`
  - the named profiles, each with its own patterns and the settings it overrides; a setting it leaves out is inherited from the ones above. See [05 Profiles](<./05 Profiles.md>). Which profile is active is kept per device, outside `data.json`.
