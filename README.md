# Advanced Exclude

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/mnaoumov) [![GitHub release](https://img.shields.io/github/v/release/mnaoumov/obsidian-advanced-exclude)](https://github.com/mnaoumov/obsidian-advanced-exclude/releases) [![GitHub downloads](https://img.shields.io/github/downloads/mnaoumov/obsidian-advanced-exclude/total)](https://github.com/mnaoumov/obsidian-advanced-exclude/releases) [![Coverage: 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/mnaoumov/obsidian-advanced-exclude)

[Obsidian](https://obsidian.md/)'s `Files and links > Excluded files` setting does less than its name suggests: excluded files still sit in the Files pane, still turn up in Backlinks, still appear in search. They are de-emphasized, not excluded.

This plugin makes them behave as though they are not there, and lets you say which ones with [`gitignore`](https://git-scm.com/docs/gitignore) syntax — the pattern language you already know — kept in two places: global patterns in the plugin settings, which [`Obsidian Sync`](https://help.obsidian.md/sync) carries to every device, and local patterns in a `.obsidianignore` file for this device only. Your existing `.gitignore` and Obsidian's own setting can feed it too.

> [!WARNING]
>
> The plugin makes Obsidian behave like the ignored files do not exist. This might affect features like [`Obsidian Sync`](https://help.obsidian.md/sync), [`Obsidian Publish`](https://help.obsidian.md/publish), etc.
>
> Ensure you configured the plugin correctly to avoid data loss.

<!-- markdownlint-disable MD033 -->

<a href="https://github.com/mnaoumov/obsidian-advanced-exclude/blob/HEAD/images/screenshots/screenshot-desktop-1.png"><img src="images/screenshots/screenshot-desktop-1.png" alt="Excluded files still sit in your file explorer" width="600"></a>

<details>
<summary>More screenshots</summary>

<div>
<a href="https://github.com/mnaoumov/obsidian-advanced-exclude/blob/HEAD/images/screenshots/screenshot-desktop-2.png"><img src="images/screenshots/screenshot-desktop-2.png" alt="One gitignore line later, they are not there at all" width="600"></a>
<a href="https://github.com/mnaoumov/obsidian-advanced-exclude/blob/HEAD/images/screenshots/screenshot-mobile-1.png"><img src="images/screenshots/screenshot-mobile-1.png" alt="Excluded files still sit in your file explorer" width="270"></a>
<a href="https://github.com/mnaoumov/obsidian-advanced-exclude/blob/HEAD/images/screenshots/screenshot-mobile-2.png"><img src="images/screenshots/screenshot-mobile-2.png" alt="One gitignore line later, they are not there at all" width="270"></a>
</div>

</details>

<!-- markdownlint-enable MD033 -->

## Demo vault

**The documentation is a demo vault.** Every feature has a note that explains what it does and why you would want it, with folders already in place to hide and un-hide.

**[Start reading here](<./demo-vault/00 Start.md>)** — it is plain markdown, so it works on GitHub with nothing installed.

A copy of the vault ships with every release. You can access it via any of the following:

1. Running the **`Advanced Exclude`: Open demo vault** command.
2. Downloading `advanced-exclude-demo-vault.zip` from the [Releases](https://github.com/mnaoumov/obsidian-advanced-exclude/releases). It unzips into a single `advanced-exclude-demo-vault-<version>` folder.
3. Browsing its source in [`demo-vault/`](./demo-vault/README.md) in this repository.

## What it does

- **Exclude with `gitignore` syntax** — a folder, an extension, a path, in two settings text areas: global patterns that sync with your vault, and local patterns kept in `.obsidianignore` for one device. A line starting with `#` is a comment, as in `.gitignore`; write `\#` for a pattern that really starts with `#`. [01 Exclude a folder](<./demo-vault/01 Exclude a folder.md>)
- **Whitelist instead of blacklist**, including the negation trap that catches most people: once `*` ignores everything, folders must be re-included with `!*/` before any `!file` rule can reach inside them. [02 Whitelist with negation](<./demo-vault/02 Whitelist with negation.md>)
- **Catch pattern mistakes as you type** — every pattern box lists, under it, the lines that match nothing (an unclosed `[`, a lone `\` at the end, a `./` path) in red, and the lines that probably mean something else (a `\` between folders, a trailing space, a regular expression copied from Obsidian's `Excluded files`) in amber. Nothing is blocked: every line is still saved and applied. When `.obsidianignore` is edited outside Obsidian and gains an error, a notice names the line when you come back.

- **Choose where patterns come from and how hard they hide** — your `.gitignore`, Obsidian's own `Excluded files` setting, and how completely an ignored file disappears. The extra sources are off by default, so a fresh install changes nothing until you turn one on. [03 Exclude mode and sources](<./demo-vault/03 Exclude mode and sources.md>)
- **Hide folders left empty by exclusion**, cascading up through parents whose whole subtree went away. Genuinely empty folders stay visible. [04 Settings](<./demo-vault/04 Settings.md>)
- **Switch between profiles** — named sets of patterns and settings that compose with `@import`, so `Focus` can import `Work` and add its own lines, with `!negation` working across them as in one `.gitignore`. `@import file:<vault path>` pastes a vault file's patterns the same way, so `@import file:.gitignore` places the vault's `.gitignore` anywhere in a profile. The profiles sync with the vault; each device picks its own active one from the status bar. [05 Profiles](<./demo-vault/05 Profiles.md>)

## Similar plugins

- [`Ignore`](https://community.obsidian.md/plugins/ignore) — reads a `.obsidianignore` file in `gitignore` syntax and writes it into Obsidian's own `Excluded files` list, so the files stay in Obsidian's index; it has no synced patterns, profiles or pattern checks, and this plugin can take files out of the index altogether.
- [`Sieve`](https://community.obsidian.md/plugins/sieve) — skips files and folders while Obsidian scans the vault, with Syncthing-style rules where the first matching rule wins, and can give a vault a display name; its rules are not `gitignore` syntax.
- [`File Ignore`](https://community.obsidian.md/plugins/file-ignore) — hides a file by renaming it on disk with a leading dot, which Obsidian never indexes, so the exclusion travels with the file itself; this plugin leaves file names untouched.
- [`Shadow Tree`](https://community.obsidian.md/plugins/shadow-tree) — hides folders from the file explorer when nothing below them counts as content or a `.gitignore`-style pattern matches them, with per-folder pins and an optional Sync exclusion; it filters the explorer view rather than Obsidian's index.
- [`File Explorer++`](https://community.obsidian.md/plugins/file-explorer-plus) — hides and pins files and folders in the file explorer by wildcard or regular-expression filters on names, paths and tags; it adds pinning, which this plugin does not, and hides from the explorer only.
- [`Hide Folders`](https://community.obsidian.md/plugins/hide-folders) — toggles the visibility of folders with configured names, such as attachment folders, in the file explorer; it matches folder names rather than patterns.
- [`Explorer Hider`](https://community.obsidian.md/plugins/explorer-hider) — hides files and folders picked from the context menu in the file explorer and bookmarks, through auto-managed CSS; the files stay in Obsidian's index.
- [`File Hider`](https://community.obsidian.md/plugins/OA-file-hider) — hides files and folders picked from the context menu in the file explorer, with a command to toggle them back into view.
- [`Toggle Excluded Folders`](https://community.obsidian.md/plugins/toggle-excluded-folders) — switches Obsidian's own `Excluded files` list off and back on with one click; it keeps no patterns of its own.
- [`Ignore Filters Boost`](https://community.obsidian.md/plugins/ignore-filters-boost) — adds and removes folders in Obsidian's own `Excluded files` list from the file explorer, including excluding everything except one folder; it edits the native setting rather than extending it.

Last searched for similar plugins on 2026-10-26.

## Installation

The plugin is available in [the official Community Plugins repository](https://community.obsidian.md/plugins/advanced-exclude).

### Beta versions

To install the latest beta release of this plugin (regardless if it is available in [the official Community Plugins repository](https://community.obsidian.md) or not), follow these steps:

1. Ensure you have the [BRAT plugin](https://community.obsidian.md/plugins/obsidian42-brat) installed and enabled.
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/mnaoumov/obsidian-advanced-exclude).
3. An Obsidian pop-up window should appear. In the window, click the `Add plugin` button once and wait a few seconds for the plugin to install.

## Debugging

By default, debug messages for this plugin (id: `advanced-exclude`) are hidden.

If you need to enable them refer to the [documentation](https://mnaoumov.dev/obsidian-lib/guides/debugging/).

## Changelog

All notable changes to this project will be documented in the [CHANGELOG](./CHANGELOG.md).

## Contributing

Contributions are welcome — see [CONTRIBUTING](./CONTRIBUTING.md) to get set up.

## Support

<!-- markdownlint-disable MD033 -->

<a href="https://www.buymeacoffee.com/mnaoumov" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217"></a>

<!-- markdownlint-enable MD033 -->

## My other Obsidian resources

[See my other Obsidian resources](https://github.com/mnaoumov/obsidian-resources).

## License

© [Michael Naumov](https://github.com/mnaoumov/)
