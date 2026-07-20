# Advanced Exclude demo vault

A small Obsidian vault that demonstrates the [Advanced Exclude](https://github.com/mnaoumov/obsidian-advanced-exclude) plugin - it enhances Obsidian's **Excluded files** setting with full [`gitignore`](https://git-scm.com/docs/gitignore) syntax and makes ignored files behave as if they do not exist (hidden from the Files pane, Backlinks, Graph, and search).

Open [00 Start](<./00 Start.md>) and work through the numbered notes. Add `Archive/` to the plugin's **Ignore patterns**, then watch the folder disappear from the Files pane and the backlink vanish from [Shared/Topic](<./Shared/Topic.md>).

## First open

The first time you open this vault, Obsidian treats it as **untrusted**, so the bundled plugins are listed but not loaded until you **Trust author and enable plugins** and reload. After that, the Demo Vault Helper installs [CodeScript Toolkit](https://github.com/mnaoumov/obsidian-codescript-toolkit) and opens the start note for you.
