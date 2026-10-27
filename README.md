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

## See also

[My other Obsidian resources](https://github.com/mnaoumov/obsidian-resources)

| Plugin | Features | How `Advanced Exclude` differs |
| --- | --- | --- |
| [`Explorer Hider`](https://community.obsidian.md/plugins/explorer-hider) | Explorer and bookmark hiding through CSS; context-menu selection | Broader exclusion: index filtering rather than CSS alone |
| [`File Explorer++`](https://community.obsidian.md/plugins/file-explorer-plus) | Explorer hiding and pinning; wildcard and regex filters | Broader exclusion: can remove files from the index; no pinning |
| [`File Hider`](https://community.obsidian.md/plugins/OA-file-hider) | Explorer context-menu hiding; visibility toggle command | Broader exclusion: pattern-based index filtering |
| [`File Ignore`](https://community.obsidian.md/plugins/file-ignore) | Leading-dot renames; exclusion travels with the file | Same exclusion goal; keeps file names unchanged |
| [`Hide Folders`](https://community.obsidian.md/plugins/hide-folders) | Explorer visibility toggle by folder name | Broader exclusion: patterns across paths; index exclusion as well |
| [`Ignore`](https://community.obsidian.md/plugins/ignore) | `.obsidianignore`; native Excluded files list | Same exclusion goal; removes files from the index too; synced patterns, profiles, validation |
| [`Ignore Filters Boost`](https://community.obsidian.md/plugins/ignore-filters-boost) | Explorer actions editing native Excluded files; exclude-all-except-one | Broader exclusion: pattern rules rather than editing the native list |
| [`Shadow Tree`](https://community.obsidian.md/plugins/shadow-tree) | Explorer-only filtering; folder pins; optional Sync exclusion | Broader exclusion: can remove files from the index; no folder pinning |
| [`Sieve`](https://community.obsidian.md/plugins/sieve) | Scan-time exclusion; Syncthing-style first-match rules; vault display name | Same exclusion goal; uses `gitignore` syntax; no vault renaming |
| [`Toggle Excluded Folders`](https://community.obsidian.md/plugins/toggle-excluded-folders) | One-click toggle of native Excluded files | Broader exclusion: maintained patterns and profiles; index filtering |

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

## License

© [Michael Naumov](https://github.com/mnaoumov/)
