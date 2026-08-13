# Start here

Welcome to the [Advanced Exclude](https://github.com/mnaoumov/obsidian-advanced-exclude/) demo vault. Obsidian's built-in **Files and links > Excluded files** setting only dims files in searches - they still show up in the Files pane, Backlinks, Graph, and more. **Advanced Exclude** goes further: it makes Obsidian behave as if the ignored files do not exist at all, and it lets you choose them with full [`gitignore`](https://git-scm.com/docs/gitignore) syntax (patterns, wildcards, and negations).

> [!WARNING]
>
> Advanced Exclude makes Obsidian treat ignored files as if they do not exist. In a real vault this can affect features like Sync and Publish, so configure patterns carefully. In this throwaway demo vault there is nothing to lose - experiment freely.

**How to try it:** open [01 Exclude a folder](<./01 Exclude a folder.md>) and follow the steps - you will add `Archive/` to the plugin's ignore patterns and watch that folder disappear from the Files pane, Backlinks, and search. The other feature notes build up to whitelists and the different exclude modes.

## Feature

- [01 Exclude a folder](<./01 Exclude a folder.md>)
- [02 Whitelist with negation](<./02 Whitelist with negation.md>)
- [03 Exclude mode and sources](<./03 Exclude mode and sources.md>)
- [04 Settings](<./04 Settings.md>)
