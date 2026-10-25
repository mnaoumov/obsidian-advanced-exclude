# Exclude mode and sources

Beyond the ignore patterns from [01 Exclude a folder](<./01 Exclude a folder.md>) and [02 Whitelist with negation](<./02 Whitelist with negation.md>), `Advanced Exclude` has three more settings that change *how far* the exclusion reaches and *which sources* feed the ignore list, and a second place to keep patterns, for one device only. All of them live in **Settings -> Community plugins -> `Advanced Exclude`**; each key is documented in [04 Settings](<./04 Settings.md>).

## Exclude mode

The **Exclude mode** dropdown controls how aggressively ignored files are hidden:

- **Full** (default) - excludes files from the entire Obsidian app: the Files pane, Backlinks, Graph, search, quick switcher, everything. This is what [01 Exclude a folder](<./01 Exclude a folder.md>) demonstrates.
- **Files pane**
  - excludes files from the **Files pane only**. They stay reachable from Backlinks, Graph, and search.

Try it: with `Archive/` still ignored, switch the mode to **Files pane**. The `Archive/` folder stays hidden in the Files pane, but a search for `Draft` finds the note again. Switch back to **Full** to hide it everywhere.

```code-button
---
caption: Ignore the Archive folder (if you have not already)
---
await require('/demoSetup.ts').excludeArchiveFolder(app);
```

```code-button
---
caption: Exclude mode - Files pane only
---
await require('/demoSetup.ts').changeSettings(app, { excludeMode: 'FilesPane' });
```

```code-button
---
caption: Exclude mode - Full (the default)
---
await require('/demoSetup.ts').changeSettings(app, { excludeMode: 'Full' });
```

Manual equivalent: pick from the **Exclude mode** dropdown. Search for `Draft` after each one - it is found under **Files pane** and not under **Full**.

## Reuse Obsidian's excluded files

**Ignore excluded files** (a toggle) pulls in whatever you have configured under Obsidian's core **Files and links > Excluded files** setting and treats those entries as ignore patterns too. The **Go to settings** button next to it jumps straight to that core setting. Turn it on if you want your existing excluded-files list to get the full `Advanced Exclude` treatment.

## Reuse `.gitignore`

**Include `.gitignore` patterns** (a toggle, off by default) also honors any `.gitignore` file in your vault. If your vault is a git repository, the files git already ignores get hidden from Obsidian too - no need to restate them in the plugin. It starts off because a vault that happens to be a git repository should not change how it looks the moment the plugin is installed - turn it on when you want that.

```code-button
---
caption: Turn both source toggles on
---
await require('/demoSetup.ts').changeSettings(app, { shouldIgnoreExcludedFiles: true, shouldIncludeGitIgnorePatterns: true });
```

```code-button
---
caption: Restore the defaults for both
---
await require('/demoSetup.ts').changeSettings(app, { shouldIgnoreExcludedFiles: false, shouldIncludeGitIgnorePatterns: false });
```

Manual equivalent: toggle **Ignore excluded files** and **Include `.gitignore` patterns** above.

## Global and local patterns

The settings tab has two pattern sections, and both always apply, global first:

1. **Global patterns** are stored in the plugin's `data.json`, so [Obsidian Sync](https://help.obsidian.md/sync) carries them to your other devices. Put here what every device should hide.
2. **Local patterns** are the `.obsidianignore` file at the vault root, which the text area edits directly. Obsidian Sync never carries a file whose name starts with a dot, so these apply only on the device that has the file. Other sync tools, such as git or Syncthing, may carry it. A `!negation` here can re-include what a global pattern hid, on this device only.

The file is not created until you first type in the **Local patterns** text area, and then it starts with a few `#` comment lines saying what it is for. You can also edit it in any text editor: the plugin reads it again when you come back to Obsidian, and on desktop as soon as it changes. It keeps the line endings the file already uses.

A `.obsidianignore` from an earlier version keeps working as it is.
