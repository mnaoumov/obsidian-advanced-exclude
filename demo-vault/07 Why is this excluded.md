# Why is this excluded?

Global patterns, a profile and the files it imports, `.obsidianignore`, `.gitignore`, Obsidian's own `Excluded files`, the soft patterns: a line in any of them can hide a note, and a `!` line in another can bring it back. When a note vanishes, `Advanced Exclude` tells you which line did it.

For one file or folder it shows:

- whether it is excluded, and how: hidden from the whole app, from the Files pane, or only soft-excluded from search and the rest;
- the line that decided it, word for word, with its line number and where it lives: `line 2 of the global patterns`, `line 1 of the profile Work`, `line 3 of .obsidianignore`;
- the `!` line that brought it back, when one did;
- the earlier lines that line overrode;
- the folder it inherits its exclusion from, when a line matched the folder rather than the note. A `!` line cannot reach inside an excluded folder, so this is the usual answer to "my `!` line does nothing".

The answer comes from the very matcher that hides the files, so it never disagrees with what you see.

## Try it

1. Set up patterns that fight over one note, in the `Files pane` mode so the hidden notes stay easy to reach:

   ```code-button
   ---
   caption: Patterns that fight over Archive/Draft
   ---
   await require('/demoSetup.ts').changeSettings(app, { excludeMode: 'FilesPane', ignorePatterns: 'Archive/*\n!Archive/Draft.md\nArchive/Draft.md\n' });
   ```

   Manual equivalent: set **Exclude mode** to **Files pane**, type these three lines into **Global patterns** and apply:

   ```gitignore
   Archive/*
   !Archive/Draft.md
   Archive/Draft.md
   ```

2. Open **Settings -> Community plugins -> `Advanced Exclude`**, type `Archive/Draft.md` into **Explain a path** and press **Explain**. It says the note is excluded by `Archive/Draft.md`, line 3 of the global patterns, which overrides `!Archive/Draft.md` on line 2.
3. Type `Archive/Old note.md` and press **Explain**: line 1, `Archive/*`, hides it.
4. Right-click [Shared/Topic](<./Shared/Topic.md>) in the Files pane and choose **Why is this excluded?**. A notice says no line matches it.
5. Put everything back:

   ```code-button
   ---
   caption: Clear every ignore pattern and go back to the Full mode
   ---
   await require('/demoSetup.ts').changeSettings(app, { excludeMode: 'Full', ignorePatterns: '' });
   ```

   Manual equivalent: empty the **Global patterns** text area, set **Exclude mode** back to **Full** and apply.

## Where to ask

- **Explain a path**, in the settings tab, works for any path, a file the `Full` mode removed from the vault included. Type a folder's path to explain the folder. It explains the patterns as applied, so press **Apply** first after an edit.
- **Why is this excluded?**, in the Files pane menu of a file or a folder, works for whatever the Files pane still shows: everything in the `Soft` mode, and a note that is only soft-excluded by the [soft patterns](<./03 Exclude mode and sources.md>) in any mode.
