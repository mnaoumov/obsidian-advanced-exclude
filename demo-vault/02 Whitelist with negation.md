[Docs](https://github.com/mnaoumov/obsidian-advanced-exclude/)

# Whitelist with negation

Because Advanced Exclude uses real [`gitignore`](https://git-scm.com/docs/gitignore)
syntax, you can invert the logic: ignore **everything** and then re-include only what
you want. This is the idiom most people get wrong, so it is worth trying here.

## The trap

Once `*` ignores everything, a negated file rule like `!*.md` will **not** work on its
own, because the file's parent folder is still excluded. `gitignore` cannot re-include a
file whose parent directory is excluded. You must first re-include the directories with
`!*/`.

## Try it

1. Open **Settings -> Community plugins -> Advanced Exclude**.
2. Replace the **Ignore patterns** with:

   ```gitignore
   # Ignore everything...
   *
   # ...but keep folders traversable so the rules below can reach into them...
   !*/
   # ...and re-include only Markdown notes.
   !*.md
   ```

3. Click **Apply**.

## What you should see

- Any non-Markdown files disappear, while your `.md` notes stay visible.
- Remove the `!*/` line and click **Apply** again: now the `!*.md` rule can no longer
  reach into folders, so notes inside subfolders (like `Shared/` and `Archive/`) get
  hidden too. Add `!*/` back to restore them.

## Whitelist specific folders instead

The same pattern works for whole folders - keep only `Shared/`:

```gitignore
*
!Shared/
!Shared/**
```

When you are done experimenting, clear the **Ignore patterns** to bring every file back.
See [[03 Exclude mode and sources]] for how these patterns combine with `.gitignore`
files and Obsidian's own excluded-files list.
