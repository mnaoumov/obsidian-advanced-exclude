# Exclude from the Files pane menu

You do not have to type a `gitignore` line to exclude something. Right-click a file or a folder in the Files pane, or a selection of several, and pick one of two items:

- **Exclude** adds a line for each item, anchored at the vault root: `/Archive/Draft.md` for a file, `/Archive/` for a folder.
- **Exclude everything else in this folder** keeps the items and hides their siblings, with the whitelist pair `/Archive/*` and `!/Archive/Draft.md`. It shows only when every selected item sits in the same folder.

A character that means something in a `gitignore` line, such as `*` or `[`, is escaped, so the line matches the item's name and nothing else. A line the patterns already have is not added twice.

## Try it

1. Right-click [Archive/Draft](<./Archive/Draft.md>) in the Files pane and choose **Exclude**. It disappears, and a notice names the line it added.
2. Clear the patterns again:

   ```code-button
   ---
   caption: Clear every ignore pattern
   ---
   await require('/demoSetup.ts').clearIgnorePatterns(app);
   ```

   Manual equivalent: empty the **Global patterns** text area and apply.

3. Right-click [Archive/Old note](<./Archive/Old note.md>) and choose **Exclude everything else in this folder**. `Draft` disappears and `Old note` stays.

## Where the lines go

By default the menu writes to the **Global patterns**, which sync with the vault. To keep the lines on this device only, switch the **Files pane menu writes to** setting to **Local patterns**, and they go to `.obsidianignore` instead:

```code-button
---
caption: Files pane menu - write to .obsidianignore
---
await require('/demoSetup.ts').changeSettings(app, { excludeMenuLayer: 'Local' });
```

```code-button
---
caption: Files pane menu - write to the global patterns (the default)
---
await require('/demoSetup.ts').changeSettings(app, { excludeMenuLayer: 'Global' });
```

Manual equivalent: **Settings -> Community plugins -> `Advanced Exclude` -> Files pane menu writes to**. Lines written to `.obsidianignore` are removed by emptying the **Local patterns** text area.

While a [profile](<./05 Profiles.md>) is active, the global patterns are the base settings the profile builds on, and the notice says so. If another line, or the profile, still overrides the new line, the notice names the items it did not change. The menu never writes into a profile.
