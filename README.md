# Advanced Exclude

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

## Installation

The plugin is not available in [the official Community Plugins repository](https://obsidian.md/plugins) yet.

The Obsidian team [decided](https://github.com/obsidianmd/obsidian-releases/pull/5856#issuecomment-2824346972) to not accept this plugin to the repository.

### Beta versions

To install the latest beta release of this plugin (regardless if it is available in [the official Community Plugins repository](https://obsidian.md/plugins) or not), follow these steps:

1. Ensure you have the [BRAT plugin](https://obsidian.md/plugins?id=obsidian42-brat) installed and enabled.
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/mnaoumov/obsidian-advanced-exclude).
3. An Obsidian pop-up window should appear. In the window, click the `Add plugin` button once and wait a few seconds for the plugin to install.

## Debugging

By default, debug messages for this plugin are hidden.

To show them, run the following command in the `DevTools Console`:

```js
window.DEBUG.enable('advanced-exclude');
```

For more details, refer to the [documentation](https://github.com/mnaoumov/obsidian-dev-utils/blob/main/docs/debugging.md).

## Support

<!-- markdownlint-disable MD033 -->
<a href="https://www.buymeacoffee.com/mnaoumov" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217"></a>
<!-- markdownlint-enable MD033 -->

## License

© [Michael Naumov](https://github.com/mnaoumov/)
