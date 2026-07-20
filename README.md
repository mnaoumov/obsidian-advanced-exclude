# Advanced Exclude

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/mnaoumov)
[![GitHub release](https://img.shields.io/github/v/release/mnaoumov/obsidian-advanced-exclude)](https://github.com/mnaoumov/obsidian-advanced-exclude/releases)
[![GitHub downloads](https://img.shields.io/github/downloads/mnaoumov/obsidian-advanced-exclude/total)](https://github.com/mnaoumov/obsidian-advanced-exclude/releases)
[![Coverage: 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/mnaoumov/obsidian-advanced-exclude)

This is a plugin for [Obsidian](https://obsidian.md/) that enhances the `Excluded files` setting bringing `gitignore` syntax.

Obsidian has `Files and links > Excluded files` setting, but it is not as useful, because the excluded files are still present in the `Files` pane, appear in `Backlinks` pane, etc.

The plugin adds the following features:

- Configure ignore patterns using [`gitignore`](https://git-scm.com/docs/gitignore) syntax.
- `.obsidianignore` file for manual editing.
- Support ignore patterns from `.gitignore` file.
- Reuse existing `Files and links > Excluded files` setting in string/regexp format.

> [!WARNING]
>
> The plugin makes Obsidian behave like the ignored files do not exist. This might affect features like [`Obsidian Sync`](https://help.obsidian.md/sync), [`Obsidian Publish`](https://help.obsidian.md/publish), etc.
>
> Ensure you configured the plugin correctly to avoid data loss.

## Demo vault

A demo vault with usage examples ships with every release. You can access it via any of the following:

1. Running the **Advanced Exclude: Open demo vault** command.
2. Downloading `advanced-exclude.demo-vault.zip` from the [Releases](https://github.com/mnaoumov/obsidian-advanced-exclude/releases).
3. Browsing its source in [`demo-vault/`](./demo-vault/README.md) in this repository.

## Pattern examples

Patterns use [`gitignore`](https://git-scm.com/docs/gitignore) syntax. A few common recipes:

Ignore a folder and everything under it:

```gitignore
Archive/
```

Ignore all files with a given extension, anywhere in the vault:

```gitignore
*.png
```

Ignore **everything except** a few file types (a whitelist). This is the idiom most people get wrong: once `*` ignores everything, you must re-include directories with `!*/` **before** a negated file rule can match inside them — otherwise the files stay ignored because their parent folder is still excluded:

```gitignore
# Ignore everything...
*
# ...but keep folders traversable so the rules below can reach into them...
!*/
# ...and re-include these file types.
!*.md
!*.canvas
!*.base
```

Whitelist specific folders instead of file types:

```gitignore
*
!Journal/
!Journal/**
!Templates/
!Templates/**
```

> [!NOTE]
>
> The `!*/` (or `!Folder/`) line is required by `gitignore` itself: *"It is not possible to re-include a file if a parent directory of that file is excluded."* Re-including the directory is what lets the later `!...` file rules take effect.

See the [official `gitignore` pattern format](https://git-scm.com/docs/gitignore#_pattern_format) for the full syntax.

## Installation

The plugin is available in [the official Community Plugins repository](https://community.obsidian.md/plugins/advanced-exclude).

### Beta versions

To install the latest beta release of this plugin (regardless if it is available in [the official Community Plugins repository](https://community.obsidian.md) or not), follow these steps:

1. Ensure you have the [BRAT plugin](https://community.obsidian.md/plugins/obsidian42-brat) installed and enabled.
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/mnaoumov/obsidian-advanced-exclude).
3. An Obsidian pop-up window should appear. In the window, click the `Add plugin` button once and wait a few seconds for the plugin to install.

## Debugging

By default, debug messages for this plugin are hidden.

To show them, run the following command in the `DevTools Console`:

```js
window.DEBUG.enable('advanced-exclude');
```

For more details, refer to the [documentation](https://mnaoumov.dev/obsidian-dev-utils/guides/debugging/).

## Support

<!-- markdownlint-disable MD033 -->

<a href="https://www.buymeacoffee.com/mnaoumov" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217"></a>

<!-- markdownlint-enable MD033 -->

## My other Obsidian resources

[See my other Obsidian resources](https://github.com/mnaoumov/obsidian-resources).

## License

© [Michael Naumov](https://github.com/mnaoumov/)
