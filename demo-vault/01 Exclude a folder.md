# Exclude a folder

The simplest use of Advanced Exclude: hide an entire folder and everything under it.
This vault ships an `Archive/` folder with two notes - [Archive/Old note](<./Archive/Old note.md>) and
[Archive/Draft](<./Archive/Draft.md>) - as the exclusion target.

## Before you start

1. In the Files pane, confirm you can see the `Archive/` folder with its two notes.
2. Open [Shared/Topic](<./Shared/Topic.md>) and show its **Backlinks** pane (right-click the tab ->
   **Backlinks for the current file**). Note the backlink from `Old note`.

## Exclude it

1. Open **Settings -> Community plugins -> Advanced Exclude**.
2. In the **Ignore patterns** text area, add a line:

   ```gitignore
   Archive/
   ```

3. Click **Apply** (or close Settings - patterns are applied on close too).

## What you should see

- `Archive/` and both notes vanish from the **Files pane**.
- The backlink from `Old note` disappears from [Shared/Topic](<./Shared/Topic.md>)'s **Backlinks** pane.
- A global **Search** for `Draft` no longer returns the archived note.
- The excluded notes drop out of **Graph view**.

The trailing slash in `Archive/` matters: it targets a folder. See [04 Settings](<./04 Settings.md>)
for the setting key this text area writes to, and [02 Whitelist with negation](<./02 Whitelist with negation.md>)
for the inverse - hiding everything *except* a few files.

> [!TIP]
>
> You can also edit the ignore list outside Settings: the same patterns live in an
> `.obsidianignore` file at the vault root, which you can open and edit as plain text.
